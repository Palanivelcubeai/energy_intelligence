import re

with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = r\"\"\"              {\['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4', 'CNC-5'\].map\(\(machine, idx\) => \(\s*<Area\s*key=\{machine\}\s*type=\"monotone\"\s*dataKey=\{\\$\{machine\}_co2\\}\s*name=\{machine\}\s*stackId=\"1\"\s*stroke=\{COLORS\[idx % COLORS.length\]\}\s*strokeWidth=\{2\}\s*fill=\{\url\(#color\$\{machine\}\)\\}\s*</div>\s*\{\/\* Production vs\"\"\"

replacement = r\"\"\"              {['CNC-1', 'CNC-2', 'CNC-3', 'CNC-4', 'CNC-5'].map((machine, idx) => (
                <Area
                  key={machine}
                  type=\"monotone\"
                  dataKey={${machine}_co2}
                  name={machine}
                  stackId=\"1\"
                  stroke={COLORS[idx % COLORS.length]}
                  strokeWidth={2}
                  fill={url(#color)}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Production vs\"\"\"

text = re.sub(pattern, replacement, text)

with open('D:/CAS IOT/energy_intelligence-pavin/energy_intelligence-pavin/frontend/src/pages/Overview.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
