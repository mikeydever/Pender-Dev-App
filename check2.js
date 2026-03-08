    // ── CONFIG ──────────────────────────────────────────────────────
    const PASSWORD = 'pender2024';
    const PROPERTY_COST = 500000;
    const CONFIG_KEY = 'pender_supabase_config';

    const CAT_COLORS = {
      'Construction / Labour': '#4a7c59', 'Materials & Supplies': '#8aab7e',
      'Permits & Legal': '#7a5c3a', 'Professional Services': '#a07820',
      'Landscaping': '#2d4a3e', 'Utilities & Site Setup': '#a8c8c4',
      'Transportation': '#c4a882', 'Accommodation': '#b8860b',
      'Taxes & Fees': '#b85a2a', 'Other': '#888',
    };
    const PCOLS = ['#2d4a3e', '#4a7c59', '#7a5c3a', '#a07820', '#b85a2a', '#8aab7e', '#a8c8c4', '#c4a882', '#666', '#999'];

    // ── STATE ───────────────────────────────────────────────────────
    let supabase = null;
    let expenses = [];
    let charts = {};
    let selectedFile = null;

    // ── INIT ────────────────────────────────────────────────────────
    async function startup() {
      try {
        if (!window.supabase) throw new Error("Supabase library not loaded. Check connection or adblocker.");
        const config = getConfig();
        if (!config) {
          hide('loading-screen'); show('setup-screen'); return;
        }
        initSupabase(config.url, config.key);
        hide('loading-screen');
        show('login-screen');
      } catch (err) {
        console.error(err);
        document.querySelector('.loading-text').innerHTML =
          `<span style="color:var(--rust)">Error:<br>${err.message}</span>`;
      }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      startup();
    } else {
      document.addEventListener('DOMContentLoaded', startup);
    }

    function getConfig() {
      try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch (e) { return null; }
    }

    function initSupabase(url, key) {
      supabase = window.supabase.createClient(url, key);
    }

    // ── SETUP ───────────────────────────────────────────────────────
    async function saveSupabaseConfig() {
      const url = document.getElementById('setup-url').value.trim();
      const key = document.getElementById('setup-key').value.trim();
      if (!url || !key) { alert('Please enter both the URL and API key.'); return; }

      try {
        initSupabase(url, key);
        // Test connection
        const { error } = await supabase.from('expenses').select('id').limit(1);
        if (error) throw error;
        localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
        hide('setup-screen'); show('login-screen');
        toast('Connected to Supabase! ✓');
      } catch (e) {
        alert('Connection failed: ' + e.message + '\n\nPlease check your URL and API key.');
      }
    }

    // ── AUTH ────────────────────────────────────────────────────────
    function tryLogin() {
      const v = document.getElementById('pw-input').value;
      if (v === PASSWORD) {
        hide('login-screen'); show('app');
        loadData();
      } else {
        document.getElementById('login-error').textContent = 'Incorrect password.';
        document.getElementById('pw-input').value = '';
      }
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') tryLogin();
    });

    function logout() {
      hide('app'); show('login-screen');
      document.getElementById('pw-input').value = '';
      document.getElementById('login-error').textContent = '';
    }

    // ── DATA ────────────────────────────────────────────────────────
    async function loadData() {
      setSyncing(true);
      try {
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .order('date', { ascending: false });
        if (error) throw error;
        expenses = data || [];
        setSyncing(false);
        initApp();
      } catch (e) {
        setSyncing(false, true);
        toast('Error loading data: ' + e.message, true);
      }
    }

    function setSyncing(syncing, error = false) {
      const dot = document.getElementById('sync-dot');
      const label = document.getElementById('sync-label');
      dot.className = 'sync-dot' + (syncing ? ' syncing' : error ? ' error' : '');
      label.textContent = syncing ? 'Syncing…' : error ? 'Error' : 'Live';
    }

    function fmt(n) {
      return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function groupBy(arr, key) {
      return arr.reduce((acc, item) => {
        const k = item[key] || 'Unknown';
        if (!acc[k]) acc[k] = [];
        acc[k].push(item); return acc;
      }, {});
    }

    // ── APP INIT ────────────────────────────────────────────────────
    function initApp() {
      populateCategoryFilter();
      renderDashboard();
      renderTable();
      renderProviders();
      renderYearly();
    }

    function populateCategoryFilter() {
      const sel = document.getElementById('filter-cat');
      // Clear existing options except first
      while (sel.options.length > 1) sel.remove(1);
      [...new Set(expenses.map(e => e.category))].sort().forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
      });
    }

    function showTab(name) {
      ['dashboard', 'expenses', 'providers', 'yearly'].forEach(t => {
        document.getElementById('tab-' + t).style.display = t === name ? 'block' : 'none';
      });
      document.querySelectorAll('.navtab').forEach((el, i) => {
        el.classList.toggle('active', ['dashboard', 'expenses', 'providers', 'yearly'][i] === name);
      });
    }

    // ── DASHBOARD ───────────────────────────────────────────────────
    function renderDashboard() {
      const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
      document.getElementById('banner-dev-cost').textContent = fmt(total);
      document.getElementById('banner-total').textContent = fmt(total + PROPERTY_COST);
      document.getElementById('kpi-total').textContent = fmt(total);
      document.getElementById('kpi-count').textContent = expenses.length;
      document.getElementById('kpi-receipts').textContent = expenses.filter(e => e.receipt_url).length;

      const provT = Object.entries(groupBy(expenses, 'provider'))
        .map(([k, v]) => ({ name: k, total: v.reduce((s, e) => s + Number(e.amount), 0) }))
        .sort((a, b) => b.total - a.total);
      if (provT.length) {
        document.getElementById('kpi-top-provider').textContent = provT[0].name;
        document.getElementById('kpi-top-provider-amount').textContent = fmt(provT[0].total) + ' total';
      }

      const catT = Object.entries(groupBy(expenses, 'category'))
        .map(([k, v]) => ({ name: k, total: v.reduce((s, e) => s + Number(e.amount), 0) }))
        .sort((a, b) => b.total - a.total);

      drawBar('chart-provider',
        provT.slice(0, 8).map(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name),
        provT.slice(0, 8).map(d => d.total),
        provT.slice(0, 8).map((_, i) => PCOLS[i % PCOLS.length]));
      drawDoughnut('chart-category', catT.map(d => d.name), catT.map(d => d.total), catT.map(d => CAT_COLORS[d.name] || '#888'));
      drawLine();
    }

    function drawBar(id, labels, data, colors) {
      if (charts[id]) charts[id].destroy();
      charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
        type: 'bar', data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } },
            y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } }
          }
        }
      });
    }

    function drawDoughnut(id, labels, data, colors) {
      if (charts[id]) charts[id].destroy();
      charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
        type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fdfaf4', hoverOffset: 8 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { font: { family: 'Nunito', size: 11 }, color: '#2a2318', boxWidth: 14, padding: 10 } },
            tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) } }
          }
        }
      });
    }

    function drawLine() {
      if (charts['monthly']) charts['monthly'].destroy();
      const byM = {};
      [...expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
        const k = e.date.slice(0, 7); byM[k] = (byM[k] || 0) + Number(e.amount);
      });
      const keys = Object.keys(byM).sort();
      const labels = keys.map(k => { const [y, m] = k.split('-'); return new Date(y, m - 1).toLocaleString('en-CA', { month: 'short', year: '2-digit' }); });
      const ctx = document.getElementById('chart-monthly').getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 200);
      grad.addColorStop(0, 'rgba(74,124,89,.3)'); grad.addColorStop(1, 'rgba(74,124,89,.02)');
      charts['monthly'] = new Chart(ctx, {
        type: 'line', data: { labels, datasets: [{ data: keys.map(k => byM[k]), borderColor: '#4a7c59', backgroundColor: grad, fill: true, tension: .4, pointBackgroundColor: '#2d4a3e', pointRadius: 4, pointHoverRadius: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } },
            y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } }
          }
        }
      });
    }

    // ── TABLE ───────────────────────────────────────────────────────
    function renderTable() {
      const search = document.getElementById('search-input').value.toLowerCase();
      const year = document.getElementById('filter-year').value;
      const cat = document.getElementById('filter-cat').value;

      let filtered = expenses.filter(e => {
        const ms = !search || e.provider.toLowerCase().includes(search) || e.description.toLowerCase().includes(search);
        return ms && (!year || String(e.year) === year) && (!cat || e.category === cat);
      }).sort((a, b) => b.date.localeCompare(a.date));

      const tbody = document.getElementById('expense-tbody');
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--driftwood)">No expenses found</td></tr>'; return;
      }
      tbody.innerHTML = filtered.map(e => {
        const col = CAT_COLORS[e.category] || '#888';
        const d = new Date(e.date + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
        const receipt = e.receipt_url
          ? `<a class="receipt-link" href="${e.receipt_url}" target="_blank">${e.receipt_name && e.receipt_name.endsWith('.pdf') ? '📄' : '🖼'} View</a>`
          : `<span style="color:var(--driftwood);font-size:12px">—</span>`;
        return `<tr>
      <td style="color:var(--bark);font-size:13px">${d}</td>
      <td style="font-weight:600">${e.provider}</td>
      <td style="color:var(--bark)">${e.description}</td>
      <td><span class="category-badge" style="background:${col}22;color:${col}">${e.category}</span></td>
      <td class="amount-cell">${fmt(e.amount)}</td>
      <td>${receipt}</td>
      <td><button class="delete-btn" onclick="deleteExpense('${e.id}')">✕</button></td>
    </tr>`;
      }).join('');
    }

    async function deleteExpense(id) {
      if (!confirm('Remove this expense?')) return;
      setSyncing(true);
      try {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) throw error;
        expenses = expenses.filter(e => e.id !== id);
        setSyncing(false);
        renderAll();
        toast('Expense deleted');
      } catch (e) {
        setSyncing(false, true);
        toast('Error: ' + e.message, true);
      }
    }

    // ── PROVIDERS ───────────────────────────────────────────────────
    function renderProviders() {
      const data = Object.entries(groupBy(expenses, 'provider'))
        .map(([n, v]) => ({ name: n, total: v.reduce((s, e) => s + Number(e.amount), 0), count: v.length }))
        .sort((a, b) => b.total - a.total);
      const max = Math.max(...data.map(d => d.total));
      document.getElementById('provider-grid').innerHTML = data.map((p, i) => {
        const pct = (p.total / max * 100).toFixed(1);
        return `<div class="provider-card">
      <div class="provider-name">${p.name}</div>
      <div class="provider-total">${fmt(p.total)}</div>
      <div class="provider-bar-wrap"><div class="provider-bar" style="width:${pct}%;background:${PCOLS[i % PCOLS.length]}"></div></div>
      <div class="provider-count">${p.count} transaction${p.count !== 1 ? 's' : ''} · ${pct}% of total</div>
    </div>`;
      }).join('');
    }

    // ── YEARLY ──────────────────────────────────────────────────────
    function renderYearly() {
      const byY = groupBy(expenses, 'year');
      const years = Object.keys(byY).sort();
      const totals = years.map(y => byY[y].reduce((s, e) => s + Number(e.amount), 0));
      document.getElementById('yearly-cards').innerHTML = years.map((y, i) => `
    <div class="card">
      <div class="card-label">${y}</div>
      <div class="card-value">${fmt(totals[i])}</div>
      <div class="card-sub">${byY[y].length} transactions</div>
    </div>`).join('');
      if (charts['yearly']) charts['yearly'].destroy();
      charts['yearly'] = new Chart(document.getElementById('chart-yearly').getContext('2d'), {
        type: 'bar', data: { labels: years, datasets: [{ data: totals, backgroundColor: years.map((_, i) => PCOLS[i]), borderRadius: 10, borderSkipped: false }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 14 }, color: '#7a5c3a' } },
            y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 12 }, color: '#7a5c3a' } }
          }
        }
      });
    }

    function renderAll() { renderDashboard(); renderTable(); renderProviders(); renderYearly(); }

    // ── FILE UPLOAD ─────────────────────────────────────────────────
    function handleDragOver(e) { e.preventDefault(); document.getElementById('upload-area').classList.add('drag-over'); }
    function handleDragLeave() { document.getElementById('upload-area').classList.remove('drag-over'); }
    function handleDrop(e) {
      e.preventDefault();
      document.getElementById('upload-area').classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) setFile(file);
    }
    function handleFileSelect(e) { if (e.target.files[0]) setFile(e.target.files[0]); }

    function setFile(file) {
      if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10MB)', true); return; }
      selectedFile = file;
      const icon = file.type === 'application/pdf' ? '📄' : '🖼';
      document.getElementById('upload-file-icon').textContent = icon;
      document.getElementById('upload-file-name').textContent = file.name;
      document.getElementById('upload-area').style.display = 'none';
      document.getElementById('upload-preview').style.display = 'block';
      document.getElementById('upload-progress-bar').style.width = '0%';
    }

    function clearFile() {
      selectedFile = null;
      document.getElementById('file-input').value = '';
      document.getElementById('upload-area').style.display = 'block';
      document.getElementById('upload-preview').style.display = 'none';
      document.getElementById('upload-progress-bar').style.width = '0%';
    }

    async function uploadReceipt(file) {
      const ext = file.name.split('.').pop();
      const path = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      document.getElementById('upload-progress-bar').style.width = '40%';
      const { data, error } = await supabase.storage.from('receipts').upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      document.getElementById('upload-progress-bar').style.width = '100%';
      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
      return { url: urlData.publicUrl, name: file.name };
    }

    // ── MODAL ───────────────────────────────────────────────────────
    function openModal() {
      document.getElementById('modal-overlay').classList.add('open');
      document.getElementById('m-date').value = new Date().toISOString().slice(0, 10);
    }
    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('open');
      ['m-date', 'm-amount', 'm-provider', 'm-desc', 'm-notes'].forEach(id => document.getElementById(id).value = '');
      clearFile();
      document.getElementById('save-btn').disabled = false;
    }
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    async function saveExpense() {
      const date = document.getElementById('m-date').value;
      const amount = parseFloat(document.getElementById('m-amount').value);
      const provider = document.getElementById('m-provider').value.trim();
      const desc = document.getElementById('m-desc').value.trim();
      const category = document.getElementById('m-cat').value;
      const notes = document.getElementById('m-notes').value.trim();

      if (!date || !amount || !provider || !desc) { toast('Please fill in all required fields', true); return; }

      const btn = document.getElementById('save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      setSyncing(true);

      try {
        let receipt_url = null;
        let receipt_name = null;

        if (selectedFile) {
          btn.textContent = 'Uploading…';
          const result = await uploadReceipt(selectedFile);
          receipt_url = result.url;
          receipt_name = result.name;
        }

        const newExp = {
          date, amount, provider,
          description: desc,
          category, notes,
          year: parseInt(date.slice(0, 4)),
          receipt_url,
          receipt_name
        };

        const { data, error } = await supabase.from('expenses').insert([newExp]).select().single();
        if (error) throw error;

        expenses.unshift(data);
        setSyncing(false);
        closeModal();
        renderAll();
        toast('Expense saved ✓');
      } catch (e) {
        setSyncing(false, true);
        toast('Error saving: ' + e.message, true);
        btn.disabled = false;
        btn.textContent = 'Save Expense';
      }
    }

    // ── HELPERS ─────────────────────────────────────────────────────
    function show(id) { document.getElementById(id).style.display = id === 'app' ? 'block' : 'flex'; }
    function hide(id) { document.getElementById(id).style.display = 'none'; }

    let toastTimer;
    function toast(msg, error = false) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show' + (error ? ' error' : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
    }
