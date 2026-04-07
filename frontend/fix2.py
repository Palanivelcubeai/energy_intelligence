with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'r', encoding='utf-8') as f:
    text = f.read()
import re
text = re.sub(
    r'(<Legend iconType="circle".*?)\<Area\s+key=\{machine\}\s+type=\"monotone\"\s+dataKey=\{\\$\{machine\}_co2\\}\s+name=\{machine\}\s+stackId=\"1\"\s+stroke=\{COLORS\[idx % COLORS\.length\]\}\s+strokeWidth=\{2\}\s+fill=\{\url\(\#color\$\{machine\}\)\\}\s+</div>',
    r'\1<Area key={machine} type="monotone" dataKey={${machine}_co2} name={machine} stackId="1" stroke={COLORS[idx % COLORS.length]} strokeWidth={2} fill={url(#color)} /> ))} </AreaChart> </ResponsiveContainer> </div>',
    text,
    flags=re.DOTALL
)
with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
