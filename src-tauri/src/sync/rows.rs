use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::now_ms;

pub(super) const TOMBSTONE_KEEP_MS: u64 = 730 * 24 * 60 * 60 * 1000;

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

/// Seconds since the epoch for a time written like `2026-09-15T08:00:00+10:00`, so two ways of
/// writing the same moment compare equal. None when the text is not in that form.
pub(super) fn taken_secs(time: &str) -> Option<i64> {
    let t = time.as_bytes();
    let num = |at: usize, len: usize| -> Option<i64> {
        let digits = t.get(at..at + len)?;
        digits.iter().all(u8::is_ascii_digit).then(|| digits.iter().fold(0, |n, d| n * 10 + i64::from(d - b'0')))
    };
    let at = |i: usize, c: u8| t.get(i) == Some(&c);
    if !(at(4, b'-') && at(7, b'-') && at(10, b'T') && at(13, b':') && at(16, b':')) {
        return None;
    }
    let (year, month, day) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let clock = num(11, 2)? * 3600 + num(14, 2)? * 60 + num(17, 2)?;
    let mut rest = 19;
    if at(rest, b'.') {
        rest += 1;
        while t.get(rest).is_some_and(u8::is_ascii_digit) {
            rest += 1;
        }
    }
    let offset_mins = match t.get(rest) {
        Some(b'Z') if rest + 1 == t.len() => 0,
        Some(&sign @ (b'+' | b'-')) if rest + 6 == t.len() && at(rest + 3, b':') => {
            let mins = num(rest + 1, 2)? * 60 + num(rest + 4, 2)?;
            if sign == b'-' { -mins } else { mins }
        }
        _ => return None,
    };
    // Days since 1970-01-01, counting years from March so the leap day falls last.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(days * 86_400 + clock - offset_mins * 60)
}

/// Rows with the same stamp are ordered by content, so every device settles on the same one.
/// `beats` in merge.ts keeps the same order.
pub(super) fn beats(incoming: &Row, existing: &Row) -> bool {
    fn key(r: &Row) -> (u64, bool, u64, &str, &str, &str, Option<i64>) {
        (r.updated, r.deleted.is_some(), r.mmol.to_bits(), &r.unit, &r.context, &r.note, taken_secs(&r.time))
    }
    key(incoming) > key(existing)
}

/// A deletion this old is no longer passed around; every device drops it on its own.
pub(super) fn expired(row: &Row, now: u64) -> bool {
    row.deleted.is_some_and(|at| at + TOMBSTONE_KEEP_MS < now)
}

pub(super) fn live_rows(rows: &BTreeMap<String, Row>) -> Vec<Row> {
    let now = now_ms();
    rows.values().filter(|r| !expired(r, now)).cloned().collect()
}

/// Fingerprint of everything that syncs. Times count by the moment they name, since devices may
/// write the same moment differently. With `times` false they are left out, as older versions do.
pub(super) fn digest_rows(rows: &BTreeMap<String, Row>, times: bool) -> u64 {
    let now = now_ms();
    let mut h: u64 = 0xcbf29ce484222325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes.iter().chain(&[0x1f]) {
            h = (h ^ *b as u64).wrapping_mul(0x100000001b3);
        }
    };
    for r in rows.values().filter(|r| !expired(r, now)) {
        feed(r.id.as_bytes());
        feed(&r.updated.to_le_bytes());
        feed(&[r.deleted.is_some() as u8]);
        feed(&r.mmol.to_bits().to_le_bytes());
        feed(r.unit.as_bytes());
        feed(r.context.as_bytes());
        feed(r.note.as_bytes());
        if times {
            match taken_secs(&r.time) {
                Some(secs) => feed(&secs.to_le_bytes()),
                None => feed(r.time.as_bytes()),
            }
        }
    }
    h
}

/// Keeps the newer of two rows by their `updated` stamp. Returns how many local rows changed.
pub(super) fn merge_rows(local: &mut BTreeMap<String, Row>, incoming: Vec<Row>) -> usize {
    let mut changed = 0;
    let now = now_ms();
    for row in incoming {
        if expired(&row, now) && !local.contains_key(&row.id) {
            continue;
        }
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

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(in crate::sync) fn row(id: &str, updated: u64, deleted: Option<u64>) -> Row {
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

    pub(in crate::sync) fn at(id: &str, updated: u64, time: &str) -> Row {
        Row { time: time.into(), ..row(id, updated, None) }
    }

    #[test]
    fn reading_times_are_read_as_moments() {
        assert_eq!(taken_secs("2026-09-15T08:00:00+10:00"), Some(1_789_423_200));
        assert_eq!(taken_secs("2026-09-14T22:00:00.000Z"), Some(1_789_423_200));
        assert_eq!(taken_secs("2000-02-29T23:59:59-05:30"), Some(951_888_599));
        assert_eq!(taken_secs("1969-12-31T23:59:59+00:00"), Some(-1));
        assert_eq!(taken_secs("2026-09-15 08:00"), None);
        assert_eq!(taken_secs("2026-09-15T08:00:00+10:00 "), None);
    }

    #[test]
    fn equal_stamps_with_different_times_converge() {
        let early = at("a", 10, "2026-09-15T08:00:00+10:00");
        let late = at("a", 10, "2026-09-15T09:00:00+10:00");
        let mut a = BTreeMap::from([("a".to_string(), early.clone())]);
        let mut b = BTreeMap::from([("a".to_string(), late.clone())]);
        assert_ne!(digest_rows(&a, true), digest_rows(&b, true));
        assert_eq!(digest_rows(&a, false), digest_rows(&b, false));
        merge_rows(&mut a, vec![late]);
        merge_rows(&mut b, vec![early]);
        assert_eq!(a, b);
        assert_eq!(a["a"].time, "2026-09-15T09:00:00+10:00");
    }

    /// The page runs the same cases against `beats` in merge.ts.
    #[test]
    fn ties_are_settled_the_way_the_shared_cases_say() {
        let file: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/merge-order.json")).unwrap();
        let row = |change: &serde_json::Value| -> Row {
            let mut whole = file["base"].clone();
            for (field, value) in change.as_object().unwrap() {
                whole[field] = value.clone();
            }
            serde_json::from_value(whole).unwrap()
        };
        for case in file["cases"].as_array().unwrap() {
            let (a, b) = (row(&case["a"]), row(&case["b"]));
            let name = case["name"].as_str().unwrap();
            assert_eq!(beats(&a, &b), case["wins"] == "a", "{name}");
            assert_eq!(beats(&b, &a), case["wins"] == "b", "{name}");
        }
    }

    #[test]
    fn the_same_moment_written_another_way_is_not_a_change() {
        let here = at("a", 10, "2026-09-15T08:00:00+10:00");
        let there = at("a", 10, "2026-09-14T22:00:00+00:00");
        assert!(!beats(&here, &there) && !beats(&there, &here));
        let a = BTreeMap::from([("a".to_string(), here)]);
        let b = BTreeMap::from([("a".to_string(), there)]);
        assert_eq!(digest_rows(&a, true), digest_rows(&b, true));
    }

    #[test]
    fn deletions_past_their_keep_time_stop_travelling() {
        let long_ago = now_ms() - TOMBSTONE_KEEP_MS - 1000;
        let stale = row("stale", long_ago, Some(long_ago));
        let mut local = BTreeMap::new();
        assert_eq!(merge_rows(&mut local, vec![stale.clone(), row("recent", 20, Some(now_ms()))]), 1);
        assert!(!local.contains_key("stale"));

        let mut with = BTreeMap::from([("a".to_string(), row("a", 10, None))]);
        let without = with.clone();
        with.insert("stale".into(), stale.clone());
        assert_eq!(digest_rows(&with, true), digest_rows(&without, true));
        assert_eq!(live_rows(&with).len(), 1);

        let mut holding_live = BTreeMap::from([("stale".to_string(), row("stale", 1, None))]);
        assert_eq!(merge_rows(&mut holding_live, vec![stale]), 1, "a device that still shows the row takes the deletion");
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
}
