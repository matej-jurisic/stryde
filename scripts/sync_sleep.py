#!/usr/bin/env python3
"""
Syncs Garmin sleep data into Stryde as done Sleep occurrences.

Usage:
  pip install garminconnect requests
  python sync_sleep.py

Set credentials via environment variables or edit the constants below.
"""

import os
import sys
import json
from datetime import datetime, timezone, timedelta

import requests
import garminconnect

# ── config ────────────────────────────────────────────────────────────────────

GARMIN_EMAIL    = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")

STRYDE_URL      = os.environ.get("STRYDE_URL", "https://stryde.operum.app")
STRYDE_USERNAME = os.environ.get("STRYDE_USERNAME", "")
STRYDE_PASSWORD = os.environ.get("STRYDE_PASSWORD", "")

DAYS_BACK = 7   # how many past days to check

# ── stryde helpers ────────────────────────────────────────────────────────────

def stryde_login():
    r = requests.post(f"{STRYDE_URL}/api/auth/login", json={
        "username": STRYDE_USERNAME,
        "password": STRYDE_PASSWORD,
    })
    r.raise_for_status()
    return r.json()["accessToken"]


def get_or_create_sleep_activity(token):
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{STRYDE_URL}/api/activities", headers=h)
    r.raise_for_status()
    for a in r.json():
        if a["title"] == "Sleep":
            print(f"  Found existing Sleep activity: {a['id']}")
            return a["id"]
    r = requests.post(f"{STRYDE_URL}/api/activities", json={"title": "Sleep"}, headers=h)
    r.raise_for_status()
    aid = r.json()["id"]
    print(f"  Created Sleep activity: {aid}")
    return aid


def get_existing_sleep_starts(token, activity_id):
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{STRYDE_URL}/api/occurrences", params={"activityId": activity_id}, headers=h)
    r.raise_for_status()
    return [
        datetime.fromisoformat(o["startAt"].replace("Z", "+00:00"))
        for o in r.json() if o.get("startAt")
    ]


def create_sleep(token, activity_id, start_dt, end_dt):
    h = {"Authorization": f"Bearer {token}"}
    duration = int((end_dt - start_dt).total_seconds() / 60)
    r = requests.post(f"{STRYDE_URL}/api/occurrences", json={
        "activityId": activity_id,
        "startAt": start_dt.isoformat(),
        "endAt": end_dt.isoformat(),
        "isAllDay": False,
        "isPlanned": False,
        "durationMinutes": duration,
    }, headers=h)
    r.raise_for_status()
    occ_id = r.json()["id"]
    # Mark done
    r = requests.post(f"{STRYDE_URL}/api/occurrences/{occ_id}/status",
                      json={"status": "done"}, headers=h)
    r.raise_for_status()
    return occ_id

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    missing = [k for k in ("GARMIN_EMAIL", "GARMIN_PASSWORD", "STRYDE_USERNAME", "STRYDE_PASSWORD")
               if not os.environ.get(k)]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}")
        print("Set them or edit the constants at the top of this script.")
        sys.exit(1)

    # Garmin
    print("Logging into Garmin Connect...")
    garmin = garminconnect.Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    garmin.login()
    print(f"  OK — {garmin.get_full_name()}")

    # Stryde
    print("Logging into Stryde...")
    token = stryde_login()
    print("  OK")

    activity_id = get_or_create_sleep_activity(token)
    existing_starts = get_existing_sleep_starts(token, activity_id)
    print(f"  Already have {len(existing_starts)} sleep occurrence(s)")

    today = datetime.now(tz=timezone.utc).date()
    created = skipped = errors = 0

    for days_ago in range(DAYS_BACK, -1, -1):
        date = today - timedelta(days=days_ago)
        date_str = date.strftime("%Y-%m-%d")
        print(f"\n{date_str}")

        try:
            raw = garmin.get_sleep_data(date_str)
        except Exception as e:
            print(f"  Garmin error: {e}")
            errors += 1
            continue

        # Print raw so we can inspect the shape on first run
        daily = raw.get("dailySleepDTO") or {}
        print(f"  Raw keys: {list(daily.keys())[:10]}")

        start_ms = daily.get("sleepStartTimestampGMT") or daily.get("sleepStartTimestampLocal")
        end_ms   = daily.get("sleepEndTimestampGMT")   or daily.get("sleepEndTimestampLocal")

        if not start_ms or not end_ms:
            print(f"  No timestamps — skipping")
            skipped += 1
            continue

        start_dt = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
        end_dt   = datetime.fromtimestamp(end_ms   / 1000, tz=timezone.utc)
        duration = int((end_dt - start_dt).total_seconds() / 60)
        print(f"  Sleep: {start_dt:%H:%M} → {end_dt:%H:%M} UTC  ({duration // 60}h {duration % 60}m)")

        if any(abs((start_dt - s).total_seconds()) <= 3 * 3600 for s in existing_starts):
            print(f"  Already synced — skipping")
            skipped += 1
            continue

        occ_id = create_sleep(token, activity_id, start_dt, end_dt)
        print(f"  Created occurrence {occ_id}")
        created += 1

    print(f"\n── done: {created} created, {skipped} skipped, {errors} errors ──")


if __name__ == "__main__":
    main()
