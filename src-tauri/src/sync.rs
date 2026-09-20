use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use iroh::{
    address_lookup::UserData,
    endpoint::{presets, Connection},
    Endpoint, EndpointAddr, EndpointId, SecretKey, TransportAddr,
};
#[cfg(not(target_os = "android"))]
use iroh_mdns_address_lookup::{DiscoveryEvent, MdnsAddressLookup};
#[cfg(not(target_os = "android"))]
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Notify};

const ALPN_SYNC: &[u8] = b"honeycomb/sync/1";
const ALPN_PAIR: &[u8] = b"honeycomb/pair/1";
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
const SYNC_INTERVAL: Duration = Duration::from_secs(120);
const CHANGE_DEBOUNCE: Duration = Duration::from_millis(1500);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Row {
    pub id: String,
    pub time: String,
    pub mmol: f64,
    pub unit: String,
    pub context: String,
    pub note: String,
    pub updated: u64,
    #[serde(default)]
    pub deleted: Option<u64>,
}

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
    Pair { device: DeviceInfo, addr: EndpointAddr, secret: Option<[u8; 4]> },
    PairOk { device: DeviceInfo, addr: EndpointAddr },
    PairRejected { reason: String },
    Sync { device: DeviceInfo, addr: EndpointAddr, rows: Vec<Row> },
    SyncOk { device: DeviceInfo, addr: EndpointAddr, rows: Vec<Row> },
}

#[derive(Serialize, Clone, Debug)]
pub struct PeerState {
    pub id: String,
    pub name: String,
    pub last_sync: Option<u64>,
    pub online: bool,
    pub syncing: bool,
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
}

struct Inner {
    device_name: String,
    peers: Vec<Peer>,
    rows: BTreeMap<String, Row>,
    online: HashMap<String, bool>,
    syncing: HashMap<String, bool>,
    nearby: HashMap<String, (String, EndpointAddr)>,
    pairing: Option<Pairing>,
    pending: HashMap<u64, oneshot::Sender<bool>>,
    next_request: u64,
    ready: bool,
}

pub struct SyncEngine {
    app: AppHandle,
    endpoint: Endpoint,
    dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
    wake: Arc<Notify>,
}

pub type Shared = Arc<SyncEngine>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    use std::io::Read;
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut out);
    } else {
        let t = now_ms().to_le_bytes();
        for (i, b) in out.iter_mut().enumerate() {
            *b = t[i % 8] ^ (i as u8).wrapping_mul(31);
        }
    }
    out
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

fn confirm_code(a: &EndpointId, b: &EndpointId) -> String {
    let (x, y) = if a.as_bytes() < b.as_bytes() { (a, b) } else { (b, a) };
    let mut h: u32 = 2166136261;
    for byte in x.as_bytes().iter().chain(y.as_bytes().iter()) {
        h ^= *byte as u32;
        h = h.wrapping_mul(16777619);
    }
    format!("{:04}", h % 10000)
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

/// Rows with the same stamp are ordered by content, so every device settles on the same one.
fn beats(incoming: &Row, existing: &Row) -> bool {
    fn key(r: &Row) -> (u64, bool, u64, &str, &str, &str) {
        (r.updated, r.deleted.is_some(), r.mmol.to_bits(), &r.unit, &r.context, &r.note)
    }
    key(incoming) > key(existing)
}

/// Keeps the newer of two rows by their `updated` stamp. Returns how many local rows changed.
fn merge_rows(local: &mut BTreeMap<String, Row>, incoming: Vec<Row>) -> usize {
    let mut changed = 0;
    for row in incoming {
        match local.get(&row.id) {
            Some(existing) if !beats(&row, existing) => {}
            _ => {
                local.insert(row.id.clone(), row);
                changed += 1;
            }
        }
    }
    changed
}

async fn request(conn: &Connection, msg: &Message) -> Result<Message, String> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(&bytes).await.map_err(|e| e.to_string())?;
    send.finish().map_err(|e| e.to_string())?;
    read_message(&mut recv).await
}

/// Lets the requester read the reply and close first; dropping the connection early loses the reply.
async fn wait_closed(conn: &Connection) {
    let _ = tokio::time::timeout(Duration::from_secs(15), conn.closed()).await;
}

async fn read_message(recv: &mut iroh::endpoint::RecvStream) -> Result<Message, String> {
    let mut len = [0u8; 4];
    recv.read_exact(&mut len).await.map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_MESSAGE {
        return Err("message too large".into());
    }
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map_err(|e| e.to_string())
}

async fn reply(send: &mut iroh::endpoint::SendStream, msg: &Message) -> Result<(), String> {
    let bytes = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(&bytes).await.map_err(|e| e.to_string())?;
    send.finish().map_err(|e| e.to_string())?;
    Ok(())
}

impl SyncEngine {
    fn my_addr(&self) -> EndpointAddr {
        let mut addr = self.endpoint.addr();
        addr.addrs.retain(|a| match a {
            TransportAddr::Relay(_) => true,
            TransportAddr::Ip(ip) => !ip.ip().is_loopback() && ip.is_ipv4(),
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

    pub async fn start(app: AppHandle, dir: PathBuf) -> Result<Shared, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let key_path = dir.join("device.key");
        let secret = match std::fs::read_to_string(&key_path) {
            Ok(hex) => {
                let bytes = data_encoding::HEXLOWER.decode(hex.trim().as_bytes()).map_err(|e| e.to_string())?;
                let arr: [u8; 32] = bytes.try_into().map_err(|_| "bad device key".to_string())?;
                SecretKey::from_bytes(&arr)
            }
            Err(_) => {
                let sk = SecretKey::generate();
                std::fs::write(&key_path, data_encoding::HEXLOWER.encode(&sk.to_bytes())).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
                }
                sk
            }
        };
        let file: DevicesFile = std::fs::read_to_string(dir.join("devices.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let device_name = file.device_name.clone().unwrap_or_else(default_device_name);

        let user_data: UserData = format!("honeycomb:{device_name}").parse().map_err(|_| "device name too long".to_string())?;
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret)
            .alpns(vec![ALPN_SYNC.to_vec(), ALPN_PAIR.to_vec()])
            .user_data_for_address_lookup(user_data)
            .bind()
            .await
            .map_err(|e| e.to_string())?;

        let engine = Arc::new(SyncEngine {
            app,
            endpoint: endpoint.clone(),
            dir,
            inner: Arc::new(Mutex::new(Inner {
                device_name,
                peers: file.peers,
                rows: BTreeMap::new(),
                online: HashMap::new(),
                syncing: HashMap::new(),
                nearby: HashMap::new(),
                pairing: None,
                pending: HashMap::new(),
                next_request: 1,
                ready: false,
            })),
            wake: Arc::new(Notify::new()),
        });

        #[cfg(not(target_os = "android"))]
        if let Ok(mdns) = MdnsAddressLookup::builder().service_name("honeycomb").build(endpoint.id()) {
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
                let _ = tokio::time::timeout(Duration::from_secs(15), e.endpoint.online()).await;
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

    fn save(&self) {
        let (device_name, peers) = {
            let g = self.inner.lock().unwrap();
            (g.device_name.clone(), g.peers.clone())
        };
        let file = DevicesFile { device_name: Some(device_name), peers };
        if let Ok(text) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(self.dir.join("devices.json"), text);
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

    fn emit_state(&self) {
        let _ = self.app.emit("sync:state", self.snapshot());
    }

    fn emit_rows(&self) {
        let rows: Vec<Row> = self.inner.lock().unwrap().rows.values().cloned().collect();
        let _ = self.app.emit("sync:rows", rows);
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
        let name = name.trim().to_string();
        if name.is_empty() {
            return;
        }
        self.inner.lock().unwrap().device_name = name;
        self.save();
        self.emit_state();
    }

    pub fn forget(&self, id: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            g.peers.retain(|p| p.id != id);
            g.online.remove(id);
        }
        self.save();
        self.emit_state();
    }

    pub async fn start_pairing(&self) -> Result<PairingState, String> {
        let _ = tokio::time::timeout(Duration::from_secs(8), self.endpoint.online()).await;
        let secret = random_bytes::<4>();
        let code = encode_code(&PairCode { id: *self.endpoint.id().as_bytes(), secret, relay: self.my_relay().map(|u| compact_relay(&u)) });
        let expires = now_ms() + PAIRING_TTL.as_millis() as u64;
        self.inner.lock().unwrap().pairing = Some(Pairing { secret, code: code.clone(), expires });
        self.emit_state();
        Ok(PairingState { code, expires })
    }

    pub fn cancel_pairing(&self) {
        self.inner.lock().unwrap().pairing = None;
        self.emit_state();
    }

    fn add_peer(&self, device: &DeviceInfo, addr: EndpointAddr) {
        let mut g = self.inner.lock().unwrap();
        if let Some(p) = g.peers.iter_mut().find(|p| p.id == device.id) {
            p.name = device.name.clone();
            p.addr = addr;
        } else {
            g.peers.push(Peer { id: device.id.clone(), name: device.name.clone(), addr, added: now_ms(), last_sync: None });
        }
    }

    /// Pairs using a code shown on the other device.
    pub async fn pair_with_code(&self, text: &str) -> Result<DeviceInfo, String> {
        let code = decode_code(text)?;
        let target = code.addr()?;
        if target.id == self.endpoint.id() {
            return Err("That is this device's own code".into());
        }
        let device = self.device();
        let msg = Message::Pair { device, addr: self.my_addr(), secret: Some(code.secret) };
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(target, ALPN_PAIR))
            .await
            .map_err(|_| "Couldn't reach the other device. Check it is open and online.".to_string())?
            .map_err(|_| "Couldn't reach the other device. Check it is open and online.".to_string())?;
        let response = request(&conn, &msg).await?;
        conn.close(0u32.into(), b"done");
        match response {
            Message::PairOk { device, addr } => {
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
        let device = self.device();
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(addr.clone(), ALPN_PAIR))
            .await
            .map_err(|_| "Couldn't reach that device".to_string())?
            .map_err(|_| "Couldn't reach that device".to_string())?;
        let _ = self.app.emit("sync:pair-waiting", confirm_code(&addr.id, &self.endpoint.id()));
        let msg = Message::Pair { device, addr: self.my_addr(), secret: None };
        let response = tokio::time::timeout(Duration::from_secs(90), request(&conn, &msg))
            .await
            .map_err(|_| "The other device didn't answer in time".to_string())??;
        conn.close(0u32.into(), b"done");
        match response {
            Message::PairOk { device, addr } => {
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
        let (mut send, mut recv) = conn.accept_bi().await.map_err(|e| e.to_string())?;
        let msg = read_message(&mut recv).await?;
        if alpn == ALPN_PAIR {
            let Message::Pair { device, addr: their_addr, secret } = msg else {
                return Err("expected pair".into());
            };
            if device.id != remote.to_string() {
                let _ = reply(&mut send, &Message::PairRejected { reason: "Identity mismatch".into() }).await;
                wait_closed(&conn).await;
                return Ok(());
            }
            let accepted = match secret {
                Some(s) => {
                    let g = self.inner.lock().unwrap();
                    matches!(&g.pairing, Some(p) if p.secret == s && p.expires > now_ms())
                }
                None => {
                    let (rx, req) = {
                        let mut g = self.inner.lock().unwrap();
                        let request_id = g.next_request;
                        g.next_request += 1;
                        let (tx, rx) = oneshot::channel();
                        g.pending.insert(request_id, tx);
                        (rx, PairRequest { request_id, device: device.clone(), code: confirm_code(&remote, &self.endpoint.id()) })
                    };
                    let _ = self.app.emit("sync:pair-request", req.clone());
                    if let Some(w) = self.app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let outcome = tokio::time::timeout(Duration::from_secs(80), rx).await;
                    self.inner.lock().unwrap().pending.remove(&req.request_id);
                    outcome.ok().and_then(|r| r.ok()).unwrap_or(false)
                }
            };
            if !accepted {
                let _ = reply(&mut send, &Message::PairRejected { reason: "Pairing was not accepted".into() }).await;
                wait_closed(&conn).await;
                return Ok(());
            }
            let addr = if their_addr.id == remote { their_addr } else { EndpointAddr::new(remote) };
            self.add_peer(&device, addr);
            self.inner.lock().unwrap().pairing = None;
            self.save();
            let _ = reply(&mut send, &Message::PairOk { device: self.device(), addr: self.my_addr() }).await;
            let _ = self.app.emit("sync:paired", device);
            self.emit_state();
            wait_closed(&conn).await;
            self.wake.notify_one();
            return Ok(());
        }

        let Message::Sync { device, addr: their_addr, rows } = msg else {
            return Err("expected sync".into());
        };
        let known = self.inner.lock().unwrap().peers.iter().any(|p| p.id == remote.to_string());
        if !known {
            let _ = reply(&mut send, &Message::PairRejected { reason: "Not paired".into() }).await;
            wait_closed(&conn).await;
            return Ok(());
        }
        let (changed, merged) = {
            let mut g = self.inner.lock().unwrap();
            let changed = merge_rows(&mut g.rows, rows);
            if let Some(p) = g.peers.iter_mut().find(|p| p.id == remote.to_string()) {
                p.last_sync = Some(now_ms());
                p.name = device.name.clone();
                if their_addr.id == remote && !their_addr.addrs.is_empty() {
                    p.addr = their_addr;
                }
            }
            g.online.insert(remote.to_string(), true);
            (changed, g.rows.values().cloned().collect::<Vec<_>>())
        };
        let _ = reply(&mut send, &Message::SyncOk { device: self.device(), addr: self.my_addr(), rows: merged }).await;
        wait_closed(&conn).await;
        self.save();
        if changed > 0 {
            self.emit_rows();
            let _ = self.app.emit("sync:pulled", serde_json::json!({ "from": device.name, "changed": changed }));
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
        let peers: Vec<Peer> = self.inner.lock().unwrap().peers.clone();
        for peer in peers {
            self.inner.lock().unwrap().syncing.insert(peer.id.clone(), true);
            self.emit_state();
            let ok = self.sync_peer(&peer).await.is_ok();
            {
                let mut g = self.inner.lock().unwrap();
                g.syncing.insert(peer.id.clone(), false);
                g.online.insert(peer.id.clone(), ok);
            }
            self.emit_state();
        }
    }

    async fn sync_peer(&self, peer: &Peer) -> Result<(), String> {
        let rows: Vec<Row> = self.inner.lock().unwrap().rows.values().cloned().collect();
        let mut addr = peer.addr.clone();
        if let Some((_, nearby)) = self.inner.lock().unwrap().nearby.get(&peer.id) {
            addr = addr.with_addrs(nearby.addrs.iter().cloned());
        }
        let conn = match tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(addr, ALPN_SYNC)).await {
            Ok(Ok(c)) => c,
            _ => tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(EndpointAddr::new(peer.addr.id), ALPN_SYNC))
                .await
                .map_err(|_| "timeout".to_string())?
                .map_err(|e| e.to_string())?,
        };
        let response = request(&conn, &Message::Sync { device: self.device(), addr: self.my_addr(), rows }).await?;
        conn.close(0u32.into(), b"done");
        match response {
            Message::SyncOk { device, addr, rows } => {
                let changed = {
                    let mut g = self.inner.lock().unwrap();
                    let changed = merge_rows(&mut g.rows, rows);
                    if let Some(p) = g.peers.iter_mut().find(|p| p.id == peer.id) {
                        p.last_sync = Some(now_ms());
                        p.name = device.name.clone();
                        if addr.id.to_string() == peer.id && !addr.addrs.is_empty() {
                            p.addr = addr;
                        }
                    }
                    changed
                };
                self.save();
                if changed > 0 {
                    self.emit_rows();
                    let _ = self.app.emit("sync:pulled", serde_json::json!({ "from": device.name, "changed": changed }));
                }
                Ok(())
            }
            Message::PairRejected { reason } => Err(reason),
            _ => Err("unexpected reply".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, updated: u64, deleted: Option<u64>) -> Row {
        Row { id: id.into(), time: "2026-09-15T08:00:00+10:00".into(), mmol: 6.4, unit: "mmol/L".into(), context: String::new(), note: String::new(), updated, deleted }
    }

    #[test]
    fn merge_keeps_newer_and_tombstones() {
        let mut local = BTreeMap::new();
        local.insert("a".into(), row("a", 10, None));
        local.insert("b".into(), row("b", 20, None));
        let changed = merge_rows(&mut local, vec![row("a", 5, None), row("b", 30, Some(30)), row("c", 1, None)]);
        assert_eq!(changed, 2);
        assert_eq!(local["a"].updated, 10);
        assert_eq!(local["b"].deleted, Some(30));
        assert!(local.contains_key("c"));
    }

    #[test]
    fn equal_stamps_converge() {
        let mut edited = row("a", 10, None);
        edited.note = "edited on a".into();
        let deleted = row("a", 10, Some(10));
        let mut a = BTreeMap::from([("a".to_string(), edited.clone())]);
        let mut b = BTreeMap::from([("a".to_string(), deleted.clone())]);
        merge_rows(&mut a, vec![deleted]);
        merge_rows(&mut b, vec![edited]);
        assert_eq!(a, b);
        assert!(a["a"].deleted.is_some());
    }

    #[test]
    fn offline_device_catches_up_both_ways() {
        let mut a = BTreeMap::new();
        let mut b = BTreeMap::new();
        for id in ["r1", "r2", "r3"] {
            a.insert(id.into(), row(id, 100, None));
            b.insert(id.into(), row(id, 100, None));
        }
        // B goes offline. A adds, edits and deletes.
        a.insert("r4".into(), row("r4", 200, None));
        a.get_mut("r2").unwrap().updated = 210;
        a.get_mut("r2").unwrap().note = "edited".into();
        a.get_mut("r3").unwrap().updated = 220;
        a.get_mut("r3").unwrap().deleted = Some(220);
        // B adds one of its own while offline.
        b.insert("r5".into(), row("r5", 205, None));
        // B comes back: one exchange each way.
        let a_rows: Vec<Row> = a.values().cloned().collect();
        merge_rows(&mut b, a_rows);
        let b_rows: Vec<Row> = b.values().cloned().collect();
        merge_rows(&mut a, b_rows);
        assert_eq!(a, b);
        assert_eq!(a.len(), 5);
        assert_eq!(a["r2"].note, "edited");
        assert!(a["r3"].deleted.is_some());
        assert!(a.contains_key("r5"));
    }

    #[test]
    fn code_round_trips() {
        let sk = SecretKey::generate();
        let relay = "https://usw1-1.relay.n0.iroh.link./";
        assert_eq!(compact_relay(relay), "usw1-1");
        assert_eq!(expand_relay("usw1-1"), relay);
        assert_eq!(expand_relay("https://relay.example.org/"), "https://relay.example.org/");
        let code = PairCode { id: *sk.public().as_bytes(), secret: [1, 2, 3, 4], relay: Some(compact_relay(relay)) };
        let text = encode_code(&code);
        assert!(text.len() < 100, "code is {} chars", text.len());
        let back = decode_code(&text).unwrap();
        let addr = back.addr().unwrap();
        assert_eq!(addr.id, sk.public());
        assert!(addr.addrs.iter().any(|a| matches!(a, TransportAddr::Relay(u) if u.to_string() == relay)));
        assert_eq!(back.secret, [1, 2, 3, 4]);
        assert!(decode_code("nonsense").is_err());
    }

    #[test]
    fn confirm_code_is_symmetric() {
        let a = SecretKey::generate().public();
        let b = SecretKey::generate().public();
        assert_eq!(confirm_code(&a, &b), confirm_code(&b, &a));
        assert_eq!(confirm_code(&a, &b).len(), 4);
    }
}
