use super::rows::tests::{at, row};
use super::*;

/// Records what the engine would have shown, and answers pairing prompts the way a user would.
struct FakeUi {
    events: Mutex<Vec<(String, serde_json::Value)>>,
    engine: Mutex<Option<Shared>>,
    accept: bool,
}

impl FakeUi {
    fn saw(&self, event: &str) -> usize {
        self.events.lock().unwrap().iter().filter(|(name, _)| name == event).count()
    }

    fn last(&self, event: &str) -> serde_json::Value {
        self.events.lock().unwrap().iter().rev().find(|(name, _)| name == event).map(|(_, v)| v.clone()).unwrap_or_default()
    }
}

impl Ui for FakeUi {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        if event == "sync:pair-request" || event == "sync:pair-confirm" {
            let id = payload["request_id"].as_u64().unwrap();
            if let Some(engine) = self.engine.lock().unwrap().as_ref() {
                engine.respond_pair(id, self.accept);
            }
        }
        self.events.lock().unwrap().push((event.to_string(), payload));
    }
}

struct Device {
    engine: Shared,
    ui: Arc<FakeUi>,
    dir: PathBuf,
}

impl Drop for Device {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// An engine with no relays or discovery, reachable on loopback only.
async fn device(name: &str, accept: bool) -> Device {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("honeycomb-sync-test-{}-{n}-{name}", std::process::id()));
    let ui = Arc::new(FakeUi { events: Mutex::new(Vec::new()), engine: Mutex::new(None), accept });
    let net = Network { relays: false, mdns: false, loopback: true, online_wait: Duration::ZERO };
    let engine = SyncEngine::start(ui.clone(), dir.clone(), net).await.unwrap();
    engine.set_device_name(name.to_string());
    *ui.engine.lock().unwrap() = Some(engine.clone());
    for _ in 0..100 {
        if !engine.my_addr().addrs.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!engine.my_addr().addrs.is_empty(), "{name} never got an address");
    Device { engine, ui, dir }
}

/// The answering side finishes its work after the caller has already moved on.
async fn eventually(what: &str, check: impl Fn() -> bool) {
    for _ in 0..200 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("never happened: {what}");
}

fn pair(a: &Device, b: &Device) {
    a.engine.add_peer(&b.engine.device(), b.engine.my_addr());
    b.engine.add_peer(&a.engine.device(), a.engine.my_addr());
}

fn ids(d: &Device) -> Vec<String> {
    d.engine.inner.lock().unwrap().rows.keys().cloned().collect()
}

#[test]
fn the_public_lookup_is_not_told_the_device_name() {
    #[derive(Debug, Default)]
    struct Seen(Mutex<Vec<EndpointData>>);
    impl AddressLookup for Seen {
        fn publish(&self, data: &EndpointData) {
            self.0.lock().unwrap().push(data.clone());
        }
    }
    let seen = Arc::new(Seen::default());
    let relay: iroh::RelayUrl = "https://relay.example./".parse().unwrap();
    let data = EndpointData::new(vec![TransportAddr::Relay(relay.clone())]).with_user_data(advert("Sam's laptop").unwrap());
    Nameless(seen.clone()).publish(&data);
    let published = seen.0.lock().unwrap();
    assert_eq!(published[0].user_data(), None);
    assert_eq!(published[0].relay_urls().collect::<Vec<_>>(), [&relay]);
}

#[test]
fn a_damaged_key_is_set_aside_and_replaced() {
    tauri::async_runtime::block_on(async {
        let dir = std::env::temp_dir().join(format!("honeycomb-sync-test-{}-damaged-key", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("device.key"), "").unwrap();
        let ui = Arc::new(FakeUi { events: Mutex::new(Vec::new()), engine: Mutex::new(None), accept: true });
        let net = Network { relays: false, mdns: false, loopback: true, online_wait: Duration::ZERO };
        let engine = SyncEngine::start(ui, dir.clone(), net).await.unwrap();
        let key = parse_key(&std::fs::read(dir.join("device.key")).unwrap()).unwrap();
        assert_eq!(key.public(), engine.endpoint.id());
        assert!(dir.join("device.key.bad").exists());
        let _ = std::fs::remove_dir_all(&dir);
    });
}

#[test]
fn paired_devices_end_up_with_the_same_rows() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        a.engine.set_rows(vec![row("from-a", 10, None)]);
        b.engine.set_rows(vec![row("from-b", 20, None), row("gone", 30, Some(now_ms()))]);
        a.engine.sync_all().await;
        assert_eq!(ids(&a), ["from-a", "from-b", "gone"]);
        assert_eq!(ids(&a), ids(&b));
        assert_eq!(a.ui.saw("sync:rows"), 1);
        eventually("b shows the rows it received", || b.ui.saw("sync:rows") == 1).await;
        let peer = &a.engine.snapshot().peers[0];
        assert!(peer.online && peer.last_sync.is_some() && !peer.unpaired);
    });
}

#[test]
fn several_peers_sync_in_one_pass() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        let c = device("c", true).await;
        pair(&a, &b);
        pair(&a, &c);
        b.engine.set_rows(vec![row("from-b", 20, None)]);
        c.engine.set_rows(vec![row("from-c", 30, None)]);
        a.engine.sync_all().await;
        assert_eq!(ids(&a), ["from-b", "from-c"]);
        assert!(a.engine.snapshot().peers.iter().all(|p| p.online && !p.syncing));
    });
}

#[test]
fn a_device_that_was_removed_is_turned_away_and_told_so() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        a.engine.add_peer(&b.engine.device(), b.engine.my_addr());
        a.engine.set_rows(vec![row("private", 10, None)]);
        a.engine.sync_all().await;
        assert!(ids(&b).is_empty());
        let peer = &a.engine.snapshot().peers[0];
        assert!(peer.unpaired && !peer.online);
    });
}

fn full_exchanges(d: &Device) -> usize {
    d.engine.full_exchanges.load(std::sync::atomic::Ordering::Relaxed)
}

#[test]
fn rows_are_only_sent_when_the_two_sides_differ() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        a.engine.set_rows(vec![row("r1", 10, None)]);
        a.engine.sync_all().await;
        assert_eq!(full_exchanges(&a), 1);

        let before = a.engine.snapshot().peers[0].last_sync;
        tokio::time::sleep(Duration::from_millis(5)).await;
        a.engine.sync_all().await;
        assert_eq!(full_exchanges(&a), 1, "nothing changed, so no rows should travel");
        assert!(a.engine.snapshot().peers[0].last_sync > before);

        b.engine.set_rows(vec![row("r2", 20, None)]);
        a.engine.sync_all().await;
        assert_eq!(full_exchanges(&a), 2);
        assert_eq!(ids(&a), ["r1", "r2"]);
    });
}

#[test]
fn sync_times_alone_do_not_rewrite_the_device_list() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        a.engine.save();
        let on_disk = || std::fs::read_to_string(a.dir.join("devices.json")).unwrap();
        let before = on_disk();
        assert!(before.contains("\"last_sync\": null"));
        a.engine.sync_all().await;
        assert!(a.engine.snapshot().peers[0].last_sync.is_some());
        assert_eq!(on_disk(), before);

        a.engine.set_device_name("renamed".into());
        assert!(on_disk().contains("renamed"));
        assert!(!on_disk().contains("\"last_sync\": null"), "a save for another reason carries the latest sync time");
    });
}

#[test]
fn a_time_edited_on_both_devices_with_the_same_stamp_settles() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        a.engine.set_rows(vec![at("r", 10, "2026-09-15T08:00:00+10:00")]);
        b.engine.set_rows(vec![at("r", 10, "2026-09-15T09:00:00+10:00")]);
        a.engine.sync_all().await;
        assert_eq!(full_exchanges(&a), 1);
        assert_eq!(a.engine.inner.lock().unwrap().rows, b.engine.inner.lock().unwrap().rows);
    });
}

/// Answers the way 0.1.3 does: a full exchange works, anything else gets hung up on.
async fn old_version_peer(rows: Vec<Row>) -> (Endpoint, DeviceInfo) {
    let endpoint = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).alpns(vec![ALPN_SYNC.to_vec()]).bind().await.unwrap();
    let device = DeviceInfo { id: endpoint.id().to_string(), name: "old".into() };
    let (ep, me) = (endpoint.clone(), device.clone());
    tauri::async_runtime::spawn(async move {
        while let Some(incoming) = ep.accept().await {
            let Ok(conn) = incoming.await else { continue };
            let Ok((mut send, mut recv)) = conn.accept_bi().await else { continue };
            if let Ok(Message::Sync { .. }) = read_message(&mut recv, MAX_MESSAGE).await {
                let _ = reply(&mut send, &Message::SyncOk { device: me.clone(), addr: ep.addr(), rows: rows.clone() }).await;
                wait_closed(&conn).await;
            }
        }
    });
    (endpoint, device)
}

#[test]
fn a_peer_on_the_old_version_still_gets_a_full_exchange() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let (old, old_device) = old_version_peer(vec![row("from-old", 5, None)]).await;
        a.engine.add_peer(&old_device, old.addr());
        a.engine.set_rows(vec![row("r1", 10, None)]);
        a.engine.sync_all().await;
        assert_eq!(ids(&a), ["from-old", "r1"]);
        assert!(a.engine.snapshot().peers[0].online);
        assert!(a.engine.inner.lock().unwrap().full_only.contains(&old_device.id));
        a.engine.sync_all().await;
        assert_eq!(full_exchanges(&a), 2, "the second round goes straight to a full exchange");
    });
}

#[test]
fn a_peer_that_sends_a_check_is_not_treated_as_old() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        let b_id = b.engine.device().id;
        a.engine.inner.lock().unwrap().full_only.insert(b_id.clone());
        b.engine.sync_all().await;
        eventually("a stops treating b as old", || !a.engine.inner.lock().unwrap().full_only.contains(&b_id)).await;
    });
}

#[test]
fn removing_a_device_tells_it_straight_away() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        pair(&a, &b);
        a.engine.forget(&b.engine.device().id);
        assert!(a.engine.snapshot().peers.is_empty());
        eventually("b learns it was removed", || b.engine.snapshot().peers[0].unpaired).await;
    });
}

#[test]
fn nearby_pairing_needs_a_yes_on_both_devices() {
    tauri::async_runtime::block_on(async {
        let b = device("b", true).await;
        let b_id = b.engine.device().id;

        let wary = device("wary", false).await;
        wary.engine.inner.lock().unwrap().nearby.insert(b_id.clone(), ("b".into(), b.engine.my_addr()));
        assert!(wary.engine.pair_nearby(&b_id).await.is_err());
        assert!(wary.engine.snapshot().peers.is_empty());
        eventually("b hears that wary said no", || b.ui.saw("sync:pair-cancelled") == 1).await;
        assert!(b.engine.snapshot().peers.is_empty(), "b must not keep a device whose user said no");
        assert_eq!(b.ui.saw("sync:paired"), 0);

        let a = device("a", true).await;
        a.engine.inner.lock().unwrap().nearby.insert(b_id.clone(), ("b".into(), b.engine.my_addr()));
        let paired = a.engine.pair_nearby(&b_id).await.unwrap();
        assert_eq!(paired.name, "b");
        assert_eq!(a.engine.snapshot().peers.len(), 1);
        assert_eq!(b.engine.snapshot().peers.len(), 1);
        assert!(b.engine.snapshot().peers.iter().any(|p| p.id == a.engine.device().id));
        assert_eq!(b.ui.saw("sync:paired"), 1);
        assert_eq!(a.ui.saw("sync:pair-confirm"), 1);
        assert!(b.ui.saw("sync:pair-request") >= 1);

        let shown_on_a = a.ui.last("sync:pair-confirm")["code"].as_str().unwrap().to_string();
        assert_eq!(shown_on_a.len(), 6);
        assert_eq!(a.ui.last("sync:pair-waiting").as_str(), Some(shown_on_a.as_str()));
        assert_eq!(b.ui.last("sync:pair-request")["code"].as_str(), Some(shown_on_a.as_str()));
        let shown_to_wary = wary.ui.last("sync:pair-waiting").as_str().unwrap().to_string();
        assert_ne!(shown_to_wary, shown_on_a, "every attempt gets its own code");
    });
}

/// Offers `secret` to `target` the way a typed code would be, and returns the answer.
async fn offer_code(target: &Device, secret: [u8; 4]) -> Message {
    let ep = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await.unwrap();
    let conn = ep.connect(target.engine.my_addr(), ALPN_PAIR).await.unwrap();
    let me = DeviceInfo { id: ep.id().to_string(), name: "guest".into() };
    let msg = Message::Pair { device: me, addr: ep.addr(), secret: Some(secret), commit: None, confirms: false };
    let answer = request(&conn, &msg, MAX_PAIR_MESSAGE).await.unwrap();
    conn.close(0u32.into(), b"done");
    answer
}

fn shown_secret(d: &Device) -> [u8; 4] {
    d.engine.inner.lock().unwrap().pairing.as_ref().unwrap().secret
}

#[test]
fn a_code_stops_working_after_too_many_wrong_guesses() {
    tauri::async_runtime::block_on(async {
        let b = device("b", true).await;
        b.engine.start_pairing().await.unwrap();
        let secret = shown_secret(&b);
        let wrong = [secret[0] ^ 1, secret[1], secret[2], secret[3]];
        for _ in 0..MAX_WRONG_CODES {
            assert!(matches!(offer_code(&b, wrong).await, Message::PairRejected { .. }));
        }
        assert!(b.engine.snapshot().pairing.is_none());
        assert!(matches!(offer_code(&b, secret).await, Message::PairRejected { .. }));
        assert!(b.engine.snapshot().peers.is_empty());

        b.engine.start_pairing().await.unwrap();
        let secret = shown_secret(&b);
        assert!(matches!(offer_code(&b, [secret[0] ^ 1, secret[1], secret[2], secret[3]]).await, Message::PairRejected { .. }));
        assert!(matches!(offer_code(&b, secret).await, Message::PairOk { .. }));
        eventually("b saves the pairing", || b.engine.snapshot().peers.len() == 1).await;
        assert!(b.engine.snapshot().pairing.is_none(), "a code works once");
    });
}

/// Asks `target` to pair on screen from a bare endpoint, as far as revealing the nonce.
async fn knock(target: &Device, name: &str) -> (Endpoint, Connection, iroh::endpoint::SendStream, iroh::endpoint::RecvStream) {
    let ep = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await.unwrap();
    let conn = ep.connect(target.engine.my_addr(), ALPN_PAIR).await.unwrap();
    let (mut send, mut recv) = conn.open_bi().await.unwrap();
    let me = DeviceInfo { id: ep.id().to_string(), name: name.into() };
    let start = Message::Pair { device: me, addr: ep.addr(), secret: None, commit: Some(commitment(&[1; 16])), confirms: true };
    write_message(&mut send, &start).await.unwrap();
    assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairChallenge { .. })));
    write_message(&mut send, &Message::PairReveal { nonce: [1; 16] }).await.unwrap();
    (ep, conn, send, recv)
}

#[test]
fn a_second_request_is_refused_while_one_is_on_screen() {
    tauri::async_runtime::block_on(async {
        let b = device("b", true).await;
        // Nobody answers, so the first request stays on screen.
        *b.ui.engine.lock().unwrap() = None;
        let _first = knock(&b, "first").await;
        eventually("b shows the first request", || b.ui.saw("sync:pair-request") == 1).await;
        let (_ep, _conn, _send, mut recv) = knock(&b, "second").await;
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairRejected { .. })));
        assert_eq!(b.ui.saw("sync:pair-request"), 1);
        assert_eq!(b.ui.last("sync:pair-request")["device"]["name"].as_str(), Some("first"));
    });
}

#[test]
fn a_request_is_refused_while_this_device_is_pairing_with_another() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let b = device("b", true).await;
        // b never answers, so a stays waiting for it.
        *b.ui.engine.lock().unwrap() = None;
        let b_id = b.engine.device().id;
        a.engine.inner.lock().unwrap().nearby.insert(b_id.clone(), ("b".into(), b.engine.my_addr()));
        let starter = a.engine.clone();
        let waiting = tauri::async_runtime::spawn(async move { starter.pair_nearby(&b_id).await });
        eventually("a waits for b", || a.ui.saw("sync:pair-waiting") == 1).await;
        let (_ep, _conn, _send, mut recv) = knock(&a, "stranger").await;
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairRejected { .. })));
        assert_eq!(a.ui.saw("sync:pair-request"), 0);
        waiting.abort();
    });
}

#[test]
fn a_starter_that_swaps_its_nonce_after_committing_is_refused() {
    tauri::async_runtime::block_on(async {
        let b = device("b", true).await;
        let cheat = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await.unwrap();
        let conn = cheat.connect(b.engine.my_addr(), ALPN_PAIR).await.unwrap();
        let (mut send, mut recv) = conn.open_bi().await.unwrap();
        let me = DeviceInfo { id: cheat.id().to_string(), name: "cheat".into() };
        let start = Message::Pair { device: me, addr: cheat.addr(), secret: None, commit: Some(commitment(&[1; 16])), confirms: true };
        write_message(&mut send, &start).await.unwrap();
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairChallenge { .. })));
        reply(&mut send, &Message::PairReveal { nonce: [2; 16] }).await.unwrap();
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairRejected { .. })));
        assert_eq!(b.ui.saw("sync:pair-request"), 0, "the user is never asked");
        assert!(b.engine.snapshot().peers.is_empty());
    });
}

#[test]
fn a_starter_on_an_older_version_is_paired_as_before() {
    tauri::async_runtime::block_on(async {
        let b = device("b", true).await;
        let old = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await.unwrap();
        let conn = old.connect(b.engine.my_addr(), ALPN_PAIR).await.unwrap();
        let (mut send, mut recv) = conn.open_bi().await.unwrap();
        let me = DeviceInfo { id: old.id().to_string(), name: "old".into() };
        let start = Message::Pair { device: me, addr: old.addr(), secret: None, commit: Some(commitment(&[1; 16])), confirms: true };
        write_without(&mut send, &start, "confirms").await;
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairChallenge { .. })));
        reply(&mut send, &Message::PairReveal { nonce: [1; 16] }).await.unwrap();
        assert!(matches!(read_message(&mut recv, MAX_PAIR_MESSAGE).await, Ok(Message::PairOk { confirms: false, .. })));
        conn.close(0u32.into(), b"done");
        eventually("b saves the pairing straight away", || b.engine.snapshot().peers.len() == 1).await;
    });
}

/// Writes a message without the given field, as a version from before that field would.
async fn write_without(send: &mut iroh::endpoint::SendStream, msg: &Message, field: &str) {
    let mut value = serde_json::to_value(msg).unwrap();
    value.as_object_mut().unwrap().remove(field);
    let bytes = serde_json::to_vec(&value).unwrap();
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.unwrap();
    send.write_all(&bytes).await.unwrap();
}

#[test]
fn pairing_with_an_answerer_on_an_older_version_still_works() {
    tauri::async_runtime::block_on(async {
        let a = device("a", true).await;
        let old = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).alpns(vec![ALPN_PAIR.to_vec()]).bind().await.unwrap();
        let info = DeviceInfo { id: old.id().to_string(), name: "old".into() };
        let (ep, me) = (old.clone(), info.clone());
        tauri::async_runtime::spawn(async move {
            let Some(incoming) = ep.accept().await else { return };
            let Ok(conn) = incoming.await else { return };
            let Ok((mut send, mut recv)) = conn.accept_bi().await else { return };
            let _ = read_message(&mut recv, MAX_PAIR_MESSAGE).await;
            let _ = write_message(&mut send, &Message::PairChallenge { nonce: [3; 16] }).await;
            let _ = read_message(&mut recv, MAX_PAIR_MESSAGE).await;
            write_without(&mut send, &Message::PairOk { device: me, addr: ep.addr(), confirms: true }, "confirms").await;
            let _ = send.finish();
            wait_closed(&conn).await;
        });
        a.engine.inner.lock().unwrap().nearby.insert(info.id.clone(), ("old".into(), old.addr()));
        let paired = a.engine.pair_nearby(&info.id).await.unwrap();
        assert_eq!(paired.id, info.id);
        assert_eq!(a.engine.snapshot().peers.len(), 1);
    });
}

#[test]
fn checks_from_older_versions_still_read() {
    let device = DeviceInfo { id: "x".into(), name: "x".into() };
    let addr = EndpointAddr::new(SecretKey::generate().public());
    let mut json = serde_json::to_value(Message::Check { device, addr, digest: 7, full_digest: Some(8) }).unwrap();
    json.as_object_mut().unwrap().remove("full_digest");
    assert!(matches!(serde_json::from_value(json.clone()), Ok(Message::Check { digest: 7, full_digest: None, .. })));
    json.as_object_mut().unwrap().insert("added_later".into(), serde_json::json!(1));
    assert!(matches!(serde_json::from_value(json), Ok(Message::Check { digest: 7, .. })), "unknown fields are ignored");
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
fn device_names_always_fit_the_advert() {
    assert_eq!(clean_device_name("  Kitchen laptop \n"), "Kitchen laptop");
    let long = clean_device_name(&"é".repeat(400));
    assert!(long.len() <= MAX_DEVICE_NAME);
    assert!(advert(&long).is_ok());
}

#[test]
fn pairing_code_depends_on_both_nonces_and_who_started() {
    let a = SecretKey::generate().public();
    let b = SecretKey::generate().public();
    let code = pairing_code(&a, &b, &[1; 16], &[2; 16]);
    assert_eq!(code.len(), 6);
    assert_eq!(code, pairing_code(&a, &b, &[1; 16], &[2; 16]));
    assert_ne!(code, pairing_code(&a, &b, &[1; 16], &[3; 16]));
    assert_ne!(code, pairing_code(&a, &b, &[9; 16], &[2; 16]));
    assert_ne!(code, pairing_code(&b, &a, &[1; 16], &[2; 16]));
    assert_ne!(commitment(&[1; 16]), commitment(&[2; 16]));
}
