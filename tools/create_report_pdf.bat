@echo off
setlocal

set ROOT=%~dp0..
set INPUT=%ROOT%\docs\ENERGY_INTELLIGENCE_PROJECT_REPORT.md
set OUTPUT=%ROOT%\docs\ENERGY_INTELLIGENCE_PROJECT_REPORT.pdf

C:/Python314/python.exe "%~dp0report_pdf_tool.py" --input "%INPUT%" --output "%OUTPUT%"

if %ERRORLEVEL% NEQ 0 (
  echo Failed to generate PDF.
  exit /b %ERRORLEVEL%
)

echo PDF generated at: %OUTPUT%
