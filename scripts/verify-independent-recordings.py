"""Verify shipped recording bytes and complete decode; no network or user data access."""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
records = json.loads((root / 'docs/research/independent-recordings.json').read_text())

def verify(record):
    media = root / 'web' / (record['id'] + '.mp3')
    assert hashlib.sha256(media.read_bytes()).hexdigest() == record['sha256'], record['id']
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-xerror', '-i', str(media),
        '-af', 'loudnorm=I=-20:TP=-2:LRA=11:print_format=json',
        '-f', 'null', '-'
    ], capture_output=True, text=True, check=True)
    report = json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}') + 1])
    # Measurement only: the filter's generated samples are discarded.
    assert float(report['input_tp']) <= -1.0, (record['id'], report)
    assert float(report['input_i']) <= -19.0, (record['id'], report)
    return {'id': record['id'], 'completeDecode': True,
            'integratedLUFS': float(report['input_i']),
            'truePeakDB': float(report['input_tp']),
            'loudnessRange': float(report['input_lra'])}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    result = list(executor.map(verify, records))
print(json.dumps({'count': len(result), 'records': result}, indent=2))
