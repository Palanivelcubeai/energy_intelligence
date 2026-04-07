with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if line.strip() == 'fill={url(#color)}':
        new_lines.append(line)
        new_lines.append('                />\n')
        new_lines.append('              ))}\n')
        new_lines.append('            </AreaChart>\n')
        new_lines.append('          </ResponsiveContainer>\n')
    else:
        new_lines.append(line)

with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
