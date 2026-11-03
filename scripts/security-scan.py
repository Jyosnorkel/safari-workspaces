#!/usr/bin/env python3
"""Heuristic secret scan: reachable Git blobs plus tracked working files. Never print matches."""
import re, subprocess, pathlib, sys
PATTERNS = {
 'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'GitHub token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})',
 'AWS access ID': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
 'provider key': rb'\b(?:sk-[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,})',
 'credential assignment': rb'''(?i)(?:META_API_KEY|MODEL_API_KEY|apiKey|api_key|token|password)\s*[=:]\s*["']([A-Za-z0-9_./+\-=]{24,})["']''',
}
def findings(data):
 for label, pattern in PATTERNS.items():
  for match in re.finditer(pattern, data):
   value = match.group(1) if label == 'credential assignment' else match.group()
   if len(set(value)) < 8 or any(marker in value.lower() for marker in [b'fake', b'example', b'process.env', b'your', b'placeholder']): continue
   yield label, data[:match.start()].count(b'\n') + 1
hits = []; count = 0
objects = subprocess.check_output(['git','rev-list','--objects','--all'], text=True).splitlines()
for entry in objects:
 oid, _, name = entry.partition(' ')
 if not name or subprocess.check_output(['git','cat-file','-t',oid]).strip() != b'blob': continue
 count += 1
 data = subprocess.check_output(['git','cat-file','blob',oid])
 hits.extend((name, label, line, oid[:12]) for label,line in findings(data))
for name in subprocess.check_output(['git','ls-files','-z']).decode().split('\0'):
 p = pathlib.Path(name)
 if name and p.is_file(): hits.extend((name,label,line,'working tree') for label,line in findings(p.read_bytes()))
for name in sys.argv[1:]:
 p=pathlib.Path(name)
 if not p.is_file(): raise SystemExit('Additional scan file not found')
 hits.extend((name,label,line,'additional artifact') for label,line in findings(p.read_bytes()))
for name,label,line,source in hits: print(f'{name}:{line}: possible {label} ({source}); value withheld')
print(f'Scanned {count} reachable Git blobs and tracked working files; {len(hits)} candidate(s).')
print('Heuristic patterns only: absence of matches is not proof of absence of secrets. Untracked files need explicit arguments; decompress archives before scanning.')
sys.exit(bool(hits))
