import re
with open('simulation/realtime_mock_40s.py', 'r') as f:
    c = f.read()
match = re.search(r'INSERT INTO machine_metrics\s*\([^\)]+\)', c)
if match:
    print(match.group(0))
