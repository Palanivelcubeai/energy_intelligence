with open('../backend/src/routes/metrics.js', 'r') as f:
    text = f.read()

# Replace the with_delta CTE
old_with_delta = '''         with_delta AS (
           SELECT
             bucket_ist,
             GREATEST(0,
               max_parts - LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
             ) AS hour_parts,
             GREATEST(0,
               max_kwh - LAG(max_kwh, 1, 0.0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
             ) AS hour_kwh
           FROM per_machine_hour
         ),'''

new_with_delta = '''         with_delta AS (
           SELECT
             bucket_ist,
             CASE
               WHEN max_parts < LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
               THEN max_parts
               ELSE max_parts - LAG(max_parts, 1, 0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
             END AS hour_parts,
             CASE
               WHEN max_kwh < LAG(max_kwh, 1, 0.0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
               THEN max_kwh
               ELSE max_kwh - LAG(max_kwh, 1, 0.0) OVER (PARTITION BY machine_id ORDER BY bucket_ist)
             END AS hour_kwh
           FROM per_machine_hour
         ),'''

text = text.replace(old_with_delta, new_with_delta)

with open('../backend/src/routes/metrics.js', 'w') as f:
    f.write(text)
