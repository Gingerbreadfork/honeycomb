use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use iroh::{
    address_lookup::{self, AddressLookup, AddressLookupBuilder, AddressLookupBuilderError, DnsAddressLookup, EndpointData, PkarrPublisher, PkarrResolver, UserData},
    endpoint::{presets, Connection, ConnectionError, VarInt},
    Endpoint, EndpointAddr, EndpointId, RelayMode, SecretKey, TransportAddr,
};
#[cfg(not(target_os = "android"))]
use iroh_mdns_address_lookup::{DiscoveryEvent, MdnsAddressLookup};
#[cfg(not(target_os = "android"))]
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Notify};

mod rows;
#[cfg(test)]
mod tests;

pub use rows::Row;
use rows::{digest_rows, live_rows, merge_rows};

const ALPN_SYNC: &[u8] = b"honeycomb/sync/1";
const ALPN_PAIR: &[u8] = b"honeycomb/pair/2";
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const MAX_PAIR_MESSAGE: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
/// Wrong codes a device may be offered before the code it is showing stops working.
const MAX_WRONG_CODES: u32 = 5;
const SYNC_INTERVAL: Duration = Duration::from_secs(120);
/// How often devices.json is rewritten when only the times of the last syncs have moved on.
const SYNC_TIMES_SAVED_EVERY: Duration = Duration::from_secs(10 * 60);
const CHANGE_DEBOUNCE: Duration = Duration::from_millis(1500);
const MAX_DEVICE_NAME: usize = 60;
const CLOSE_NOT_PAIRED: u32 = 1;
/// A phone is never listed as nearby, so no honest device asks it to pair on screen.
const PAIRS_ON_SCREEN: bool = !cfg!(target_os = "android");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Peer {
    id: String,
    name: String,
    addr: EndpointAddr,
    added: u64,
    last_sync: Option<u64>,
}

#[derive(Serialize, Deserialize, Default)]
struct DevicesFile {
    #[serde(default)]
    device_name: Option<String>,
    #[serde(default)]
    peers: Vec<Peer>,
}

#[derive(Serialize, Deserialize)]
struct PairCode {
    id: [u8; 32],
    secret: [u8; 4],
    relay: Option<String>,
}

const N0_RELAY_SUFFIX: &str = ".relay.n0.iroh.link./";

/// Default n0 relays shrink to their region tag; anything else stays a full URL.
fn compact_relay(url: &str) -> String {
    match url.strip_prefix("https://").and_then(|rest| rest.strip_suffix(N0_RELAY_SUFFIX)) {
        Some(tag) if !tag.is_empty() && !tag.contains('/') => tag.to_string(),
        _ => url.to_string(),
    }
}

fn expand_relay(text: &str) -> String {
    if text.contains("://") {
        text.to_string()
    } else {
        format!("https://{text}{N0_RELAY_SUFFIX}")
    }
}

impl PairCode {
    fn addr(&self) -> Result<EndpointAddr, String> {
        let id = EndpointId::from_bytes(&self.id).map_err(|_| "That doesn't look like a pairing code".to_string())?;
        let mut addr = EndpointAddr::new(id);
        if let Some(url) = self.relay.as_ref().and_then(|u| expand_relay(u).parse().ok()) {
            addr = addr.with_relay_url(url);
        }
        Ok(addr)
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Message {
    /// `secret` comes from a typed or scanned code. Without one, `commit` starts the on-screen code exchange.
    /// `confirms` says the starter will send `PairDone` once its own user agrees the codes match.
    Pair {
        device: DeviceInfo,
        addr: EndpointAddr,
        secret: Option<[u8; 4]>,
        commit: Option<[u8; 32]>,
        #[serde(default)]
        confirms: bool,
    },
    PairChallenge { nonce: [u8; 16] },
    PairReveal { nonce: [u8; 16] },
    /// With `confirms`, the answering device saves the pairing only after the starter's `PairDone`.
    PairOk {
        device: DeviceInfo,
        addr: EndpointAddr,
        #[serde(default)]
        confirms: bool,
    },
    /// From the starter once its user agrees, then back from the other device once it has saved the pairing.
    PairDone,
    PairRejected { reason: String },
    Sync { device: DeviceInfo, addr: EndpointAddr, rows: Vec<Row> },
    /// `digest` leaves reading times out and is what older versions compare; `full_digest` covers them too.
    Check {
        device: DeviceInfo,
        addr: EndpointAddr,
        digest: u64,
        #[serde(default)]
        full_digest: Option<u64>,
    },
    Same { device: DeviceInfo, addr: EndpointAddr },
    Differs,
    Forget,
    SyncOk { device: DeviceInfo, addr: EndpointAddr, rows: Vec<Row> },
}

#[derive(Serialize, Clone, Debug)]
pub struct PeerState {
    pub id: String,
    pub name: String,
    pub last_sync: Option<u64>,
    pub online: bool,
    pub syncing: bool,
    /// The other device has removed this one.
    pub unpaired: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct NearbyDevice {
    pub id: String,
    pub name: String,
    pub paired: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct PairingState {
    pub code: String,
    pub expires: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SyncSnapshot {
    pub device: DeviceInfo,
    pub peers: Vec<PeerState>,
    pub nearby: Vec<NearbyDevice>,
    pub pairing: Option<PairingState>,
    pub ready: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct PairRequest {
    pub request_id: u64,
    pub device: DeviceInfo,
    pub code: String,
}

struct Pairing {
    secret: [u8; 4],
    code: String,
    expires: u64,
    wrong: u32,
}

struct Inner {
    device_name: String,
    peers: Vec<Peer>,
    rows: BTreeMap<String, Row>,
    online: HashMap<String, bool>,
    syncing: HashMap<String, bool>,
    unpaired: HashSet<String>,
    /// Peers on a version that only understands a full exchange.
    full_only: HashSet<String>,
    nearby: HashMap<String, (String, EndpointAddr)>,
    pairing: Option<Pairing>,
    /// An on-screen pairing started from this device is under way.
    starting: bool,
    pending: HashMap<u64, oneshot::Sender<bool>>,
    next_request: u64,
    ready: bool,
}

/// Where the engine sends its events. The app passes them to the page; tests record them.
pub trait Ui: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: serde_json::Value);
    fn show_window(&self) {}
}

impl Ui for AppHandle {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = Emitter::emit(self, event, payload);
    }

    fn show_window(&self) {
        if let Some(w) = self.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// How the endpoint reaches other devices. Tests turn everything off and connect over loopback.
#[derive(Clone, Copy)]
pub struct Network {
    pub relays: bool,
    #[cfg_attr(target_os = "android", allow(dead_code))]
    pub mdns: bool,
    pub loopback: bool,
    pub online_wait: Duration,
}

impl Default for Network {
    fn default() -> Self {
        Network { relays: true, mdns: true, loopback: false, online_wait: Duration::from_secs(15) }
    }
}

pub struct SyncEngine {
    ui: Arc<dyn Ui>,
    net: Network,
    endpoint: Endpoint,
    dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
    /// Held while devices.json is written, so two saves never share the temp file.
    saving: Mutex<Saved>,
    wake: Arc<Notify>,
    full_exchanges: std::sync::atomic::AtomicUsize,
}

pub type Shared = Arc<SyncEngine>;

/// What devices.json last held apart from sync times, and when it was written.
#[derive(Default)]
struct Saved {
    lasting: String,
    at: u64,
}

/// Builds an address lookup that publishes without the device name. The name is for devices on
/// the same network, not for a public server.
#[derive(Debug)]
struct WithoutName<B>(B);

impl<B: AddressLookupBuilder> AddressLookupBuilder for WithoutName<B> {
    fn into_address_lookup(self, endpoint: &Endpoint) -> Result<impl AddressLookup, AddressLookupBuilderError> {
        Ok(Nameless(self.0.into_address_lookup(endpoint)?))
    }
}

#[derive(Debug)]
struct Nameless<T>(T);

impl<T: AddressLookup> AddressLookup for Nameless<T> {
    fn publish(&self, data: &EndpointData) {
        let mut data = data.clone();
        data.set_user_data(None);
        self.0.publish(&data);
    }

    fn resolve(&self, endpoint_id: EndpointId) -> Option<n0_future::boxed::BoxStream<Result<address_lookup::Item, address_lookup::Error>>> {
        self.0.resolve(endpoint_id)
    }
}

/// Marks an on-screen pairing started from this device as under way until dropped.
struct Starting<'a>(&'a SyncEngine);

impl Drop for Starting<'_> {
    fn drop(&mut self) {
        self.0.inner.lock().unwrap().starting = false;
    }
}

/// Writes through a temp file readable only by the user, then renames it into place.
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    crate::write_new_private(&tmp, text.as_bytes())?;
    crate::rename_over(&tmp, path)
}

/// The key held in `device.key`, or None when the file's contents are not one.
fn parse_key(saved: &[u8]) -> Option<SecretKey> {
    let hex = std::str::from_utf8(saved).ok()?.trim();
    let bytes: [u8; 32] = data_encoding::HEXLOWER.decode(hex.as_bytes()).ok()?.try_into().ok()?;
    Some(SecretKey::from_bytes(&bytes))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).map_err(|_| "No source of randomness is available".to_string())?;
    Ok(out)
}

/// Trimmed and cut to a length that always fits the address lookup record.
fn clean_device_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars().filter(|c| !c.is_control()) {
        if out.len() + c.len_utf8() > MAX_DEVICE_NAME {
            break;
        }
        out.push(c);
    }
    out.trim_end().to_string()
}

fn advert(device_name: &str) -> Result<UserData, String> {
    format!("honeycomb:{device_name}").parse().map_err(|_| "device name too long".to_string())
}

fn default_device_name() -> String {
    if cfg!(target_os = "android") {
        return "Phone".into();
    }
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let short = host.split('.').next().unwrap_or("This computer").trim();
    if short.is_empty() {
        return "This computer".into();
    }
    let mut chars = short.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => "This computer".into(),
    }
}

fn commitment(nonce: &[u8; 16]) -> [u8; 32] {
    *blake3::hash(nonce).as_bytes()
}

/// The six digits both screens show. The starting device commits to its nonce before it sees the
/// other one, so neither side, nor anyone relaying between them, can steer the result.
fn pairing_code(starter: &EndpointId, answerer: &EndpointId, starter_nonce: &[u8; 16], answerer_nonce: &[u8; 16]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"honeycomb pairing code");
    hasher.update(starter.as_bytes());
    hasher.update(answerer.as_bytes());
    hasher.update(starter_nonce);
    hasher.update(answerer_nonce);
    let digest = hasher.finalize();
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest.as_bytes()[..8]);
    format!("{:06}", u64::from_le_bytes(first) % 1_000_000)
}

fn encode_code(code: &PairCode) -> String {
    let bytes = postcard::to_allocvec(code).unwrap_or_default();
    let text = data_encoding::BASE32_NOPAD.encode(&bytes).to_lowercase();
    let chunks: Vec<&str> = text.as_bytes().chunks(4).map(|c| std::str::from_utf8(c).unwrap_or("")).collect();
    chunks.join("-")
}

fn decode_code(text: &str) -> Result<PairCode, String> {
    let clean: String = text.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    let bytes = data_encoding::BASE32_NOPAD.decode(clean.as_bytes()).map_err(|_| "That doesn't look like a pairing code".to_string())?;
    postcard::from_bytes(&bytes).map_err(|_| "That doesn't look like a pairing code".to_string())
}

async fn request(conn: &Connection, msg: &Message, limit: usize) -> Result<Message, String> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(&bytes).await.map_err(|e| e.to_string())?;
    send.finish().map_err(|e| e.to_string())?;
    read_message(&mut recv, limit).await
}

async fn within<T>(limit: Duration, work: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(limit, work).await.map_err(|_| "The other device stopped answering".to_string())?
}

async fn send_only(conn: &Connection, msg: &Message) -> Result<(), String> {
    let (mut send, _recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    reply(&mut send, msg).await
}

/// Lets the requester read the reply and close first; dropping the connection early loses the reply.
async fn wait_closed(conn: &Connection) {
    let _ = tokio::time::timeout(Duration::from_secs(15), conn.closed()).await;
}

async fn read_message(recv: &mut iroh::endpoint::RecvStream, limit: usize) -> Result<Message, String> {
    let mut len = [0u8; 4];
    recv.read_exact(&mut len).await.map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len) as usize;
    if len > limit {
        return Err("message too large".into());
    }
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map_err(|e| e.to_string())
}

/// Sends one message and leaves the stream open for more.
async fn write_message(send: &mut iroh::endpoint::SendStream, msg: &Message) -> Result<(), String> {
    let bytes = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(&bytes).await.map_err(|e| e.to_string())
}

async fn reply(send: &mut iroh::endpoint::SendStream, msg: &Message) -> Result<(), String> {
    write_message(send, msg).await?;
    send.finish().map_err(|e| e.to_string())
}

impl SyncEngine {
    fn my_addr(&self) -> EndpointAddr {
        let mut addr = self.endpoint.addr();
        addr.addrs.retain(|a| match a {
            TransportAddr::Relay(_) => true,
            TransportAddr::Ip(ip) => (self.net.loopback || !ip.ip().is_loopback()) && ip.is_ipv4(),
            _ => false,
        });
        addr
    }

    fn my_relay(&self) -> Option<String> {
        self.endpoint.addr().addrs.iter().find_map(|a| match a {
            TransportAddr::Relay(url) => Some(url.to_string()),
            _ => None,
        })
    }

    pub async fn start(ui: Arc<dyn Ui>, dir: PathBuf, net: Network) -> Result<Shared, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let key_path = dir.join("device.key");
        let saved = match std::fs::read(&key_path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("Couldn't read the device key: {e}")),
        };
        let secret = match saved.as_deref().and_then(parse_key) {
            Some(key) => key,
            None => {
                // A damaged key is set aside. The new one is a new identity, so paired devices
                // turn this one away until it is paired again.
                if saved.is_some() {
                    let _ = std::fs::rename(&key_path, dir.join("device.key.bad"));
                }
                let sk = SecretKey::generate();
                write_private(&key_path, &data_encoding::HEXLOWER.encode(&sk.to_bytes())).map_err(|e| e.to_string())?;
                sk
            }
        };
        let devices_path = dir.join("devices.json");
        let file: DevicesFile = match std::fs::read_to_string(&devices_path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
                let _ = std::fs::rename(&devices_path, dir.join("devices.json.bad"));
                DevicesFile::default()
            }),
            Err(_) => DevicesFile::default(),
        };
        let device_name = file
            .device_name
            .as_deref()
            .map(clean_device_name)
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| clean_device_name(&default_device_name()));

        let user_data = advert(&device_name)?;
        let builder = if net.relays {
            // The preset's own lookups, with the public one kept from publishing the device name.
            Endpoint::builder(presets::N0)
                .clear_address_lookup()
                .address_lookup(WithoutName(PkarrPublisher::n0_dns()))
                .address_lookup(PkarrResolver::n0_dns())
                .address_lookup(DnsAddressLookup::n0_dns())
        } else {
            Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled)
        };
        let endpoint = builder
            .secret_key(secret)
            .alpns(vec![ALPN_SYNC.to_vec(), ALPN_PAIR.to_vec()])
            .user_data_for_address_lookup(user_data)
            .bind()
            .await
            .map_err(|e| e.to_string())?;

        let engine = Arc::new(SyncEngine {
            ui,
            net,
            endpoint: endpoint.clone(),
            dir,
            inner: Arc::new(Mutex::new(Inner {
                device_name,
                peers: file.peers,
                rows: BTreeMap::new(),
                online: HashMap::new(),
                syncing: HashMap::new(),
                unpaired: HashSet::new(),
                full_only: HashSet::new(),
                nearby: HashMap::new(),
                pairing: None,
                starting: false,
                pending: HashMap::new(),
                next_request: 1,
                ready: false,
            })),
            saving: Mutex::new(Saved::default()),
            wake: Arc::new(Notify::new()),
            full_exchanges: Default::default(),
        });

        #[cfg(not(target_os = "android"))]
        if let Some(mdns) = net.mdns.then(|| MdnsAddressLookup::builder().service_name("honeycomb").build(endpoint.id()).ok()).flatten() {
            if let Ok(services) = endpoint.address_lookup() {
                services.add(mdns.clone());
                let e = engine.clone();
                tauri::async_runtime::spawn(async move {
                    let mut events = mdns.subscribe().await;
                    while let Some(event) = events.next().await {
                        match event {
                            DiscoveryEvent::Discovered { endpoint_info, .. } => {
                                let id = endpoint_info.endpoint_id;
                                if id == e.endpoint.id() {
                                    continue;
                                }
                                let name = endpoint_info
                                    .data
                                    .user_data()
                                    .map(|u| u.to_string())
                                    .and_then(|u| u.strip_prefix("honeycomb:").map(|s| s.to_string()));
                                if let Some(name) = name {
                                    let addr = endpoint_info.into_endpoint_addr();
                                    let paired = {
                                        let mut g = e.inner.lock().unwrap();
                                        g.nearby.insert(id.to_string(), (name, addr));
                                        g.peers.iter().any(|p| p.id == id.to_string())
                                    };
                                    e.emit_state();
                                    if paired {
                                        e.wake.notify_one();
                                    }
                                }
                            }
                            DiscoveryEvent::Expired { endpoint_id } => {
                                e.inner.lock().unwrap().nearby.remove(&endpoint_id.to_string());
                                e.emit_state();
                            }
                            _ => {}
                        }
                    }
                });
            }
        }

        {
            let e = engine.clone();
            tauri::async_runtime::spawn(async move { e.accept_loop().await });
        }
        {
            let e = engine.clone();
            tauri::async_runtime::spawn(async move { e.sync_loop().await });
        }
        {
            let e = engine.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(e.net.online_wait, e.endpoint.online()).await;
                e.inner.lock().unwrap().ready = true;
                e.emit_state();
                e.wake.notify_one();
            });
        }
        Ok(engine)
    }

    fn device(&self) -> DeviceInfo {
        DeviceInfo { id: self.endpoint.id().to_string(), name: self.inner.lock().unwrap().device_name.clone() }
    }

    /// Writes devices.json. A change to names, addresses or the list goes out at once; sync times
    /// alone wait, since every round moves them.
    fn save(&self) {
        let mut saved = self.saving.lock().unwrap();
        let (device_name, peers) = {
            let g = self.inner.lock().unwrap();
            (g.device_name.clone(), g.peers.clone())
        };
        let untimed: Vec<Peer> = peers.iter().cloned().map(|p| Peer { last_sync: None, ..p }).collect();
        let lasting = serde_json::to_string(&DevicesFile { device_name: Some(device_name.clone()), peers: untimed }).unwrap_or_default();
        let now = now_ms();
        if lasting == saved.lasting && now < saved.at + SYNC_TIMES_SAVED_EVERY.as_millis() as u64 {
            return;
        }
        let file = DevicesFile { device_name: Some(device_name), peers };
        if let Ok(text) = serde_json::to_string_pretty(&file) {
            if write_private(&self.dir.join("devices.json"), &text).is_ok() {
                *saved = Saved { lasting, at: now };
            }
        }
    }

    pub fn snapshot(&self) -> SyncSnapshot {
        let g = self.inner.lock().unwrap();
        let now = now_ms();
        let pairing = g.pairing.as_ref().filter(|p| p.expires > now).map(|p| PairingState { code: p.code.clone(), expires: p.expires });
        SyncSnapshot {
            device: DeviceInfo { id: self.endpoint.id().to_string(), name: g.device_name.clone() },
            peers: g
                .peers
                .iter()
                .map(|p| PeerState {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    last_sync: p.last_sync,
                    online: *g.online.get(&p.id).unwrap_or(&false),
                    syncing: *g.syncing.get(&p.id).unwrap_or(&false),
                    unpaired: g.unpaired.contains(&p.id),
                })
                .collect(),
            nearby: g
                .nearby
                .iter()
                .map(|(id, (name, _))| NearbyDevice { id: id.clone(), name: name.clone(), paired: g.peers.iter().any(|p| &p.id == id) })
                .collect(),
            pairing,
            ready: g.ready,
        }
    }

    fn emit<T: Serialize>(&self, event: &str, payload: T) {
        if let Ok(value) = serde_json::to_value(payload) {
            self.ui.emit(event, value);
        }
    }

    fn emit_state(&self) {
        self.emit("sync:state", self.snapshot());
    }

    fn emit_rows(&self) {
        let rows: Vec<Row> = self.inner.lock().unwrap().rows.values().cloned().collect();
        self.emit("sync:rows", rows);
    }

    pub fn set_rows(&self, rows: Vec<Row>) {
        let changed = merge_rows(&mut self.inner.lock().unwrap().rows, rows);
        if changed > 0 {
            self.wake.notify_one();
        }
    }

    pub fn replace_rows(&self, rows: Vec<Row>) {
        self.inner.lock().unwrap().rows = rows.into_iter().map(|r| (r.id.clone(), r)).collect();
        self.wake.notify_one();
    }

    pub fn set_device_name(&self, name: String) {
        let name = clean_device_name(&name);
        if name.is_empty() {
            return;
        }
        if let Ok(user_data) = advert(&name) {
            self.endpoint.set_user_data_for_address_lookup(Some(user_data));
        }
        self.inner.lock().unwrap().device_name = name;
        self.save();
        self.emit_state();
    }

    /// Removes the device here and, if it can be reached, tells it so.
    pub fn forget(self: &Arc<Self>, id: &str) {
        let removed = {
            let mut g = self.inner.lock().unwrap();
            let removed = g.peers.iter().find(|p| p.id == id).cloned();
            let already_gone = g.unpaired.remove(id);
            g.peers.retain(|p| p.id != id);
            g.online.remove(id);
            removed.filter(|_| !already_gone)
        };
        self.save();
        self.emit_state();
        if let Some(peer) = removed {
            let e = self.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(conn) = e.connect_peer(&peer).await {
                    let _ = within(IO_TIMEOUT, send_only(&conn, &Message::Forget)).await;
                    wait_closed(&conn).await;
                }
            });
        }
    }

    pub async fn start_pairing(&self) -> Result<PairingState, String> {
        let _ = tokio::time::timeout(self.net.online_wait.min(Duration::from_secs(8)), self.endpoint.online()).await;
        let secret = random_bytes::<4>()?;
        let code = encode_code(&PairCode { id: *self.endpoint.id().as_bytes(), secret, relay: self.my_relay().map(|u| compact_relay(&u)) });
        let expires = now_ms() + PAIRING_TTL.as_millis() as u64;
        self.inner.lock().unwrap().pairing = Some(Pairing { secret, code: code.clone(), expires, wrong: 0 });
        self.emit_state();
        Ok(PairingState { code, expires })
    }

    pub fn cancel_pairing(&self) {
        self.inner.lock().unwrap().pairing = None;
        self.emit_state();
    }

    fn add_peer(&self, device: &DeviceInfo, addr: EndpointAddr) {
        let name = clean_device_name(&device.name);
        let mut g = self.inner.lock().unwrap();
        g.unpaired.remove(&device.id);
        if let Some(p) = g.peers.iter_mut().find(|p| p.id == device.id) {
            p.name = name;
            p.addr = addr;
        } else {
            g.peers.push(Peer { id: device.id.clone(), name, addr, added: now_ms(), last_sync: None });
        }
    }

    /// Pairs using a code shown on the other device.
    pub async fn pair_with_code(&self, text: &str) -> Result<DeviceInfo, String> {
        let code = decode_code(text)?;
        let target = code.addr()?;
        let target_id = target.id;
        if target_id == self.endpoint.id() {
            return Err("That is this device's own code".into());
        }
        let device = self.device();
        let msg = Message::Pair { device, addr: self.my_addr(), secret: Some(code.secret), commit: None, confirms: false };
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(target, ALPN_PAIR))
            .await
            .map_err(|_| "Couldn't reach the other device. Check it is open and online.".to_string())?
            .map_err(|_| "Couldn't reach the other device. Check it is open and online.".to_string())?;
        let response = within(IO_TIMEOUT, request(&conn, &msg, MAX_PAIR_MESSAGE)).await?;
        conn.close(0u32.into(), b"done");
        match response {
            Message::PairOk { device, addr, .. } => {
                if device.id != target_id.to_string() {
                    return Err("Identity mismatch".into());
                }
                self.add_peer(&device, addr);
                self.save();
                self.emit_state();
                self.wake.notify_one();
                Ok(device)
            }
            Message::PairRejected { reason } => Err(reason),
            _ => Err("Unexpected reply while pairing".into()),
        }
    }

    /// Pairs with a device found on the local network. The other side confirms on screen.
    pub async fn pair_nearby(&self, id: &str) -> Result<DeviceInfo, String> {
        let addr = self
            .inner
            .lock()
            .unwrap()
            .nearby
            .get(id)
            .map(|(_, a)| a.clone())
            .ok_or_else(|| "That device is no longer nearby".to_string())?;
        {
            let mut g = self.inner.lock().unwrap();
            if g.starting || !g.pending.is_empty() {
                return Err("Finish the pairing that is already under way first".into());
            }
            g.starting = true;
        }
        let _starting = Starting(self);
        let device = self.device();
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(addr.clone(), ALPN_PAIR))
            .await
            .map_err(|_| "Couldn't reach that device".to_string())?
            .map_err(|_| "Couldn't reach that device".to_string())?;
        let addr_id = addr.id;
        let my_nonce = random_bytes::<16>()?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        let start = Message::Pair { device, addr: self.my_addr(), secret: None, commit: Some(commitment(&my_nonce)), confirms: true };
        write_message(&mut send, &start).await?;
        let their_nonce = match within(IO_TIMEOUT, read_message(&mut recv, MAX_PAIR_MESSAGE)).await? {
            Message::PairChallenge { nonce } => nonce,
            Message::PairRejected { reason } => return Err(reason),
            _ => return Err("Unexpected reply while pairing".into()),
        };
        write_message(&mut send, &Message::PairReveal { nonce: my_nonce }).await?;
        let code = pairing_code(&self.endpoint.id(), &addr_id, &my_nonce, &their_nonce);
        self.emit("sync:pair-waiting", code.clone());
        let response = tokio::time::timeout(Duration::from_secs(90), read_message(&mut recv, MAX_PAIR_MESSAGE))
            .await
            .map_err(|_| "The other device didn't answer in time".to_string())??;
        let (device, addr, confirms) = match response {
            Message::PairOk { device, addr, confirms } => (DeviceInfo { id: device.id, name: clean_device_name(&device.name) }, addr, confirms),
            Message::PairRejected { reason } => return Err(reason),
            _ => return Err("Unexpected reply while pairing".into()),
        };
        if device.id != addr_id.to_string() {
            conn.close(0u32.into(), b"done");
            return Err("Identity mismatch".into());
        }
        // An older device has already saved the pairing and only waits for the hang-up.
        if !confirms {
            conn.close(0u32.into(), b"done");
        }
        if !self.ask_user("sync:pair-confirm", &device, code).await {
            conn.close(0u32.into(), b"cancelled");
            return Err("Pairing was cancelled".into());
        }
        if confirms {
            reply(&mut send, &Message::PairDone).await?;
            let saved = within(IO_TIMEOUT, read_message(&mut recv, MAX_PAIR_MESSAGE)).await;
            conn.close(0u32.into(), b"done");
            if !matches!(saved, Ok(Message::PairDone)) {
                return Err("The other device stopped answering".into());
            }
        }
        self.add_peer(&device, addr);
        self.save();
        self.emit_state();
        self.wake.notify_one();
        Ok(device)
    }

    /// Shows the confirmation code on this device and waits for the user's answer.
    async fn ask_user(&self, event: &str, device: &DeviceInfo, code: String) -> bool {
        let (rx, request_id) = {
            let mut g = self.inner.lock().unwrap();
            let request_id = g.next_request;
            g.next_request += 1;
            let (tx, rx) = oneshot::channel();
            g.pending.insert(request_id, tx);
            (rx, request_id)
        };
        self.emit(event, PairRequest { request_id, device: device.clone(), code });
        let answer = tokio::time::timeout(Duration::from_secs(80), rx).await;
        self.inner.lock().unwrap().pending.remove(&request_id);
        answer.ok().and_then(|r| r.ok()).unwrap_or(false)
    }

    pub fn respond_pair(&self, request_id: u64, accept: bool) {
        if let Some(tx) = self.inner.lock().unwrap().pending.remove(&request_id) {
            let _ = tx.send(accept);
        }
    }

    pub fn request_sync(&self) {
        self.wake.notify_one();
    }

    async fn accept_loop(self: Arc<Self>) {
        while let Some(incoming) = self.endpoint.accept().await {
            let e = self.clone();
            tauri::async_runtime::spawn(async move {
                let mut accepting = match incoming.accept() {
                    Ok(a) => a,
                    Err(_) => return,
                };
                let alpn = match accepting.alpn().await {
                    Ok(a) => a,
                    Err(_) => return,
                };
                let conn = match accepting.await {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let _ = e.handle_connection(conn, &alpn).await;
            });
        }
    }

    async fn handle_connection(&self, conn: Connection, alpn: &[u8]) -> Result<(), String> {
        let remote = conn.remote_id();
        let pairing = alpn == ALPN_PAIR;
        if !pairing && !self.inner.lock().unwrap().peers.iter().any(|p| p.id == remote.to_string()) {
            conn.close(CLOSE_NOT_PAIRED.into(), b"not paired");
            return Ok(());
        }
        let limit = if pairing { MAX_PAIR_MESSAGE } else { MAX_MESSAGE };
        let (mut send, mut recv) = within(IO_TIMEOUT, async { conn.accept_bi().await.map_err(|e| e.to_string()) }).await?;
        let msg = within(IO_TIMEOUT, read_message(&mut recv, limit)).await?;
        if pairing {
            let Message::Pair { device, addr: their_addr, secret, commit, confirms } = msg else {
                return Err("expected pair".into());
            };
            if device.id != remote.to_string() {
                let _ = reply(&mut send, &Message::PairRejected { reason: "Identity mismatch".into() }).await;
                wait_closed(&conn).await;
                return Ok(());
            }
            let device = DeviceInfo { id: device.id, name: clean_device_name(&device.name) };
            let accepted = match secret {
                Some(s) => {
                    let (right, spent) = {
                        let mut g = self.inner.lock().unwrap();
                        let right = matches!(&g.pairing, Some(p) if p.secret == s && p.expires > now_ms());
                        // A code that keeps being guessed at is withdrawn before its four bytes can be worked through.
                        let spent = !right && g.pairing.as_mut().is_some_and(|p| {
                            p.wrong += 1;
                            p.wrong >= MAX_WRONG_CODES
                        });
                        if spent {
                            g.pairing = None;
                        }
                        (right, spent)
                    };
                    if spent {
                        self.emit_state();
                    }
                    right
                }
                None => {
                    if !PAIRS_ON_SCREEN {
                        let _ = reply(&mut send, &Message::PairRejected { reason: "That device pairs with a code. Show one in its Devices settings.".into() }).await;
                        wait_closed(&conn).await;
                        return Ok(());
                    }
                    let commit = commit.ok_or_else(|| "pair request without a commitment".to_string())?;
                    let my_nonce = random_bytes::<16>()?;
                    write_message(&mut send, &Message::PairChallenge { nonce: my_nonce }).await?;
                    let Message::PairReveal { nonce: their_nonce } = within(IO_TIMEOUT, read_message(&mut recv, MAX_PAIR_MESSAGE)).await? else {
                        return Err("expected the other device's nonce".into());
                    };
                    if commitment(&their_nonce) != commit {
                        let _ = reply(&mut send, &Message::PairRejected { reason: "Pairing check failed".into() }).await;
                        wait_closed(&conn).await;
                        return Ok(());
                    }
                    let code = pairing_code(&remote, &self.endpoint.id(), &their_nonce, &my_nonce);
                    // One pairing at a time, so the request on screen is never swapped for another.
                    let asked = {
                        let mut g = self.inner.lock().unwrap();
                        (!g.starting && g.pending.is_empty()).then(|| {
                            let request_id = g.next_request;
                            g.next_request += 1;
                            let (tx, rx) = oneshot::channel();
                            g.pending.insert(request_id, tx);
                            (rx, PairRequest { request_id, device: device.clone(), code })
                        })
                    };
                    let Some((rx, req)) = asked else {
                        let _ = reply(&mut send, &Message::PairRejected { reason: "That device is in the middle of another pairing. Try again in a moment.".into() }).await;
                        wait_closed(&conn).await;
                        return Ok(());
                    };
                    self.emit("sync:pair-request", req.clone());
                    self.ui.show_window();
                    let accepted = tokio::select! {
                        answer = tokio::time::timeout(Duration::from_secs(80), rx) => answer.ok().and_then(|r| r.ok()).unwrap_or(false),
                        _ = conn.closed() => false,
                    };
                    self.inner.lock().unwrap().pending.remove(&req.request_id);
                    self.emit("sync:pair-request-ended", req.request_id);
                    accepted
                }
            };
            if !accepted {
                let _ = reply(&mut send, &Message::PairRejected { reason: "Pairing was not accepted".into() }).await;
                wait_closed(&conn).await;
                return Ok(());
            }
            let addr = if their_addr.id == remote { their_addr } else { EndpointAddr::new(remote) };
            let ok = Message::PairOk { device: self.device(), addr: self.my_addr(), confirms };
            if confirms {
                write_message(&mut send, &ok).await?;
                // Hanging up or saying nothing means the user on the other device said no.
                let answer = tokio::select! {
                    answer = tokio::time::timeout(Duration::from_secs(90), read_message(&mut recv, MAX_PAIR_MESSAGE)) => answer.ok().and_then(|r| r.ok()),
                    _ = conn.closed() => None,
                };
                if !matches!(answer, Some(Message::PairDone)) {
                    self.emit("sync:pair-cancelled", device);
                    return Ok(());
                }
            } else {
                reply(&mut send, &ok).await?;
            }
            self.add_peer(&device, addr);
            self.inner.lock().unwrap().pairing = None;
            self.save();
            self.emit("sync:paired", device);
            self.emit_state();
            if confirms {
                let _ = reply(&mut send, &Message::PairDone).await;
            }
            wait_closed(&conn).await;
            self.wake.notify_one();
            return Ok(());
        }

        if matches!(msg, Message::Forget) {
            self.inner.lock().unwrap().unpaired.insert(remote.to_string());
            self.emit_state();
            conn.close(0u32.into(), b"done");
            return Ok(());
        }
        let (mut send, msg) = match msg {
            Message::Check { device, addr, digest, full_digest } => {
                let same = {
                    let mut g = self.inner.lock().unwrap();
                    // A failed check can mark a peer as too old for one; sending one shows it is not.
                    g.full_only.remove(&remote.to_string());
                    match full_digest {
                        Some(full) => digest_rows(&g.rows, true) == full,
                        None => digest_rows(&g.rows, false) == digest,
                    }
                };
                if same {
                    self.note_synced(&remote.to_string(), &device, addr);
                    let _ = reply(&mut send, &Message::Same { device: self.device(), addr: self.my_addr() }).await;
                    wait_closed(&conn).await;
                    self.save();
                    self.emit_state();
                    return Ok(());
                }
                reply(&mut send, &Message::Differs).await?;
                let (send, mut recv) = within(IO_TIMEOUT, async { conn.accept_bi().await.map_err(|e| e.to_string()) }).await?;
                (send, within(IO_TIMEOUT, read_message(&mut recv, MAX_MESSAGE)).await?)
            }
            other => (send, other),
        };
        let Message::Sync { device, addr: their_addr, rows } = msg else {
            return Err("expected sync".into());
        };
        let (changed, merged) = {
            let mut g = self.inner.lock().unwrap();
            let changed = merge_rows(&mut g.rows, rows);
            (changed, live_rows(&g.rows))
        };
        self.note_synced(&remote.to_string(), &device, their_addr);
        let _ = reply(&mut send, &Message::SyncOk { device: self.device(), addr: self.my_addr(), rows: merged }).await;
        wait_closed(&conn).await;
        self.save();
        if changed > 0 {
            self.emit_rows();
            self.emit("sync:pulled", serde_json::json!({ "from": device.name, "changed": changed }));
        }
        self.emit_state();
        Ok(())
    }

    async fn sync_loop(self: Arc<Self>) {
        loop {
            let waited = tokio::time::timeout(SYNC_INTERVAL, self.wake.notified()).await;
            if waited.is_ok() {
                tokio::time::sleep(CHANGE_DEBOUNCE).await;
            }
            let ready = self.inner.lock().unwrap().ready;
            if !ready {
                continue;
            }
            self.sync_all().await;
        }
    }

    async fn sync_all(&self) {
        let peers: Vec<Peer> = {
            let g = self.inner.lock().unwrap();
            g.peers.iter().filter(|p| !g.unpaired.contains(&p.id)).cloned().collect()
        };
        // Side by side, so a device that is out of reach doesn't hold up the rest.
        n0_future::join_all(peers.iter().map(|peer| self.sync_one(peer))).await;
    }

    async fn sync_one(&self, peer: &Peer) {
        self.inner.lock().unwrap().syncing.insert(peer.id.clone(), true);
        self.emit_state();
        let ok = self.sync_peer(peer).await.is_ok();
        {
            let mut g = self.inner.lock().unwrap();
            g.syncing.insert(peer.id.clone(), false);
            g.online.insert(peer.id.clone(), ok);
        }
        self.emit_state();
    }

    /// Tries the saved and nearby addresses first, then looks the device up by its id alone.
    async fn connect_peer(&self, peer: &Peer) -> Result<Connection, String> {
        let mut addr = peer.addr.clone();
        if let Some((_, nearby)) = self.inner.lock().unwrap().nearby.get(&peer.id) {
            addr = addr.with_addrs(nearby.addrs.iter().cloned());
        }
        match tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(addr, ALPN_SYNC)).await {
            Ok(Ok(c)) => Ok(c),
            _ => tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(EndpointAddr::new(peer.addr.id), ALPN_SYNC))
                .await
                .map_err(|_| "timeout".to_string())?
                .map_err(|e| e.to_string()),
        }
    }

    /// Records a finished exchange with a peer and keeps its name and address current.
    fn note_synced(&self, id: &str, device: &DeviceInfo, addr: EndpointAddr) {
        let mut g = self.inner.lock().unwrap();
        if let Some(p) = g.peers.iter_mut().find(|p| p.id == id) {
            p.last_sync = Some(now_ms());
            p.name = clean_device_name(&device.name);
            if addr.id.to_string() == id && !addr.addrs.is_empty() {
                p.addr = addr;
            }
        }
        g.online.insert(id.to_string(), true);
    }

    fn turned_away<T>(&self, conn: &Connection, peer: &Peer, response: &Result<T, String>) -> bool {
        let refused = matches!(conn.close_reason(), Some(ConnectionError::ApplicationClosed(close)) if close.error_code == VarInt::from_u32(CLOSE_NOT_PAIRED));
        if response.is_err() && refused {
            self.inner.lock().unwrap().unpaired.insert(peer.id.clone());
        }
        response.is_err() && refused
    }

    /// Compares fingerprints first and sends rows only when they differ.
    async fn sync_peer(&self, peer: &Peer) -> Result<(), String> {
        let conn = self.connect_peer(peer).await?;
        if self.inner.lock().unwrap().full_only.contains(&peer.id) {
            return self.exchange_rows(&conn, peer).await;
        }
        let (digest, full) = {
            let g = self.inner.lock().unwrap();
            (digest_rows(&g.rows, false), digest_rows(&g.rows, true))
        };
        let check = Message::Check { device: self.device(), addr: self.my_addr(), digest, full_digest: Some(full) };
        let answer = within(IO_TIMEOUT, request(&conn, &check, MAX_PAIR_MESSAGE)).await;
        if self.turned_away(&conn, peer, &answer) {
            return Err("not paired".into());
        }
        match answer {
            Ok(Message::Same { device, addr }) => {
                conn.close(0u32.into(), b"done");
                self.note_synced(&peer.id, &device, addr);
                self.save();
                Ok(())
            }
            Ok(Message::Differs) => self.exchange_rows(&conn, peer).await,
            _ => {
                // 0.1.3 hangs up on a message it doesn't know; it still takes a full exchange.
                let conn = self.connect_peer(peer).await?;
                self.exchange_rows(&conn, peer).await?;
                self.inner.lock().unwrap().full_only.insert(peer.id.clone());
                Ok(())
            }
        }
    }

    async fn exchange_rows(&self, conn: &Connection, peer: &Peer) -> Result<(), String> {
        self.full_exchanges.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let rows = live_rows(&self.inner.lock().unwrap().rows);
        let response = within(IO_TIMEOUT, request(conn, &Message::Sync { device: self.device(), addr: self.my_addr(), rows }, MAX_MESSAGE)).await;
        if self.turned_away(conn, peer, &response) || matches!(response, Ok(Message::PairRejected { .. })) {
            self.inner.lock().unwrap().unpaired.insert(peer.id.clone());
        }
        let response = response?;
        conn.close(0u32.into(), b"done");
        match response {
            Message::SyncOk { device, addr, rows } => {
                let changed = merge_rows(&mut self.inner.lock().unwrap().rows, rows);
                self.note_synced(&peer.id, &device, addr);
                self.save();
                if changed > 0 {
                    self.emit_rows();
                    self.emit("sync:pulled", serde_json::json!({ "from": device.name, "changed": changed }));
                }
                Ok(())
            }
            Message::PairRejected { reason } => Err(reason),
            _ => Err("unexpected reply".into()),
        }
    }
}
