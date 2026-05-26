"""Se envía al host remoto por stdin (`python3 -u -`) para imprimir una línea JSON con métricas rápidas (Linux)."""

from __future__ import annotations

import json
import os
import subprocess as sp
import time


def _read_cpu_idle_total() -> tuple[int | None, int | None]:
    try:
        with open("/proc/stat", encoding="utf-8") as f:
            line = f.readline()
        parts = line.split()
        if len(parts) < 8:
            return None, None
        nums = [int(x) for x in parts[1:8]]
        idle = nums[3]
        total = sum(nums)
        return idle, total
    except (OSError, ValueError, IndexError):
        return None, None


def _cpu_pct_sample() -> float:
    i1, t1 = _read_cpu_idle_total()
    if i1 is None or t1 is None:
        return 0.0
    time.sleep(0.08)
    i2, t2 = _read_cpu_idle_total()
    if i2 is None or t2 is None:
        return 0.0
    di = i2 - i1
    dt = t2 - t1
    if dt <= 0:
        return 0.0
    return max(0.0, min(100.0, round(100.0 * (1.0 - (di / dt)), 1)))


def _load1() -> float:
    try:
        with open("/proc/loadavg", encoding="utf-8") as f:
            return float(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        return 0.0


def _mem_kb(key: str) -> int | None:
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith(key):
                    return int(line.split()[1])
    except OSError:
        return None
    return None


def _uptime_text() -> str:
    try:
        out = sp.check_output(["uptime", "-p"], stderr=sp.DEVNULL, text=True, timeout=3).strip()
        if out:
            return out.replace("up ", "").strip()
    except (OSError, sp.CalledProcessError, sp.TimeoutExpired):
        pass
    try:
        with open("/proc/uptime", encoding="utf-8") as f:
            sec = float(f.read().split()[0])
        d = int(sec // 86400)
        if d >= 1:
            return f"{d} days"
    except (OSError, ValueError, IndexError):
        pass
    return ""


def _hostname() -> str:
    try:
        out = sp.check_output(["hostname", "-s"], stderr=sp.DEVNULL, text=True, timeout=2).strip()
        if out:
            return out.splitlines()[0].strip()
    except (OSError, sp.CalledProcessError, sp.TimeoutExpired):
        pass
    try:
        return sp.check_output(["hostname"], stderr=sp.DEVNULL, text=True, timeout=2).strip().splitlines()[0]
    except (OSError, sp.CalledProcessError, sp.TimeoutExpired):
        pass
    return ""


def _df_pct(mount: str) -> int | None:
    try:
        st = os.statvfs(mount)
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        if total <= 0:
            return None
        return max(0, min(99, int(100 * (1 - free / total))))
    except OSError:
        return None


def _net_bytes() -> tuple[int | None, int | None]:
    """Bytes acumulados RX/TX (suma de interfaces distintas de lo)."""
    try:
        with open("/proc/net/dev", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return None, None
    rx_sum = 0
    tx_sum = 0
    found = False
    for line in lines[2:]:
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        name = name.strip()
        if name == "lo":
            continue
        parts = rest.split()
        if len(parts) < 10:
            continue
        try:
            rx = int(parts[0])
            txv = int(parts[8])
        except ValueError:
            continue
        rx_sum += rx
        tx_sum += txv
        found = True
    if not found:
        return None, None
    return rx_sum, tx_sum


def main() -> None:
    mt = _mem_kb("MemTotal:")
    ma = _mem_kb("MemAvailable:")
    disks = []
    for mp in ("/", "/boot/efi", "/mnt"):
        p = _df_pct(mp)
        if p is not None:
            disks.append({"mount": mp, "pct": p})
    rx, tx = _net_bytes()
    user = os.environ.get("USER") or ""
    if not user:
        try:
            user = os.getlogin()
        except OSError:
            user = ""
    out = {
        "hostname": _hostname(),
        "cpu_pct": _cpu_pct_sample(),
        "load1": round(_load1(), 2),
        "mem_total_kb": mt,
        "mem_avail_kb": ma,
        "uptime_text": _uptime_text(),
        "user": user,
        "disks": disks,
        "rx_bytes": rx,
        "tx_bytes": tx,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
