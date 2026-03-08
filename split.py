import sys

with open("pender-island-tracker.html", "r", encoding="utf-8") as f:
    orig = f.read()

import re
# Find the LAST <script> tag which contains our code
match = list(re.finditer(r'<script>', orig))[-1]
start_idx = match.end()
end_idx = orig.rfind('</script>')
script_content = orig[start_idx:end_idx]

# Add try-catch fix to startup inside extracted JS
script_content = script_content.replace(
    'async function startup() {\n      const config = getConfig();',
    'async function startup() {\n      try {\n        const config = getConfig();\n        if (!window.supabase) throw new Error("Supabase is missing");'
)
script_content = script_content.replace(
    '  show(\'login-screen\');\n    }',
    '  show(\'login-screen\');\n      } catch(e) {\n        console.error(e);\n        document.querySelector(\'.loading-text\').innerHTML = `<span style="color:red">Error: ${e.message}</span>`;\n      }\n    }'
)

script_content = script_content.replace(
    'window.addEventListener(\'load\', async () =>',
    'window.addEventListener(\'DOMContentLoaded\', async () =>'
)

with open("app.js", "w", encoding="utf-8") as f:
    f.write(script_content)

new_html = orig[:match.start()] + '<script src="app.js"></script>' + orig[end_idx + 9:]

with open("pender-island-tracker.html", "w", encoding="utf-8") as f:
    f.write(new_html)
