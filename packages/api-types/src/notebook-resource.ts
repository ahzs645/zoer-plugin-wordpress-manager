/** Shared explicit resource/environment probe; executes only on operator request. */
export const resourceCheckSource = `import os, platform, shutil, json
from pathlib import Path

def read_limit(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None

memory = {}
for line in (read_limit('/proc/meminfo') or '').splitlines():
    key, value = line.split(':', 1)
    memory[key] = int(value.strip().split()[0]) * 1024

def gib(value):
    return round(value / 1024**3, 2) if value is not None else None

cpu_max = read_limit('/sys/fs/cgroup/cpu.max')
quota = read_limit('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')
period = read_limit('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
if cpu_max:
    q, p = cpu_max.split()
    cpu_limit = None if q == 'max' else round(int(q) / int(p), 2)
elif quota and period and int(quota) > 0:
    cpu_limit = round(int(quota) / int(period), 2)
else:
    cpu_limit = None
mem_limit = read_limit('/sys/fs/cgroup/memory.max') or read_limit('/sys/fs/cgroup/memory/memory.limit_in_bytes')
mem_bytes = int(mem_limit) if mem_limit and mem_limit.isdigit() and int(mem_limit) < 2**60 else None
home = shutil.disk_usage(Path.home())
used_mem = read_limit('/sys/fs/cgroup/memory.current') or read_limit('/sys/fs/cgroup/memory/memory.usage_in_bytes')
report = {
    'Python': platform.python_version(),
    'Working directory': os.getcwd(),
    'Cgroup memory used (GiB)': gib(int(used_mem)) if used_mem and used_mem.isdigit() else None,
    'OS': platform.system() + ' ' + platform.release(),
    'Architecture': platform.machine(),
    'Visible logical CPUs': os.cpu_count(),
    'CPU affinity count': len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else None,
    'Cgroup CPU quota (cores)': cpu_limit,
    'Visible host RAM (GiB)': gib(memory.get('MemTotal')),
    'Visible available RAM (GiB)': gib(memory.get('MemAvailable')),
    'Cgroup memory limit (GiB)': gib(mem_bytes),
    'Home capacity (GiB)': gib(home.total),
    'Home free (GiB)': gib(home.free),
    'GPU device nodes': [str(p) for p in Path('/dev').glob('nvidia[0-9]*')],
    'Note': 'Visible host capacity may exceed account quotas. Null quota means unavailable or no limit at this cgroup; parent/account limits may still apply.'
}
print(json.dumps(report, indent=2))`;

export const environmentCheckSource = resourceCheckSource + `\nimport importlib.metadata\nreport["Packages"] = dict(sorted((d.metadata.get("Name", "unknown"), d.version) for d in importlib.metadata.distributions())[:1000])\nprint("ZOER_ENVIRONMENT=" + json.dumps(report))`;
