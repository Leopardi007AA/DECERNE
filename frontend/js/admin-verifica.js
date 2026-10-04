/* Pannello admin per verificare i negozi. Nessun innerHTML con dati del database:
 * tutto passa da textContent, così un nome negozio malevolo non può eseguire codice. */
(function () {
    'use strict';
  
    var SUPABASE_URL = 'https://noqdpjlbmyjqzlmstfvx.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_ER6yqBMYCoQ561qXao-sBg_CrEv7BQ6';
    // Chiave di sessione dedicata: non si sovrappone a quella di utenti e negozi.
    var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: 'decerne-admin-auth', persistSession: true, autoRefreshToken: true }
    });
  
    var $ = function (id) { return document.getElementById(id); };
    var STATUS_LABEL = { pending: 'Da verificare', verified: 'Verificato', rejected: 'Rifiutato' };
  
    function setMsg(text, ok) {
      var m = $('msg');
      m.textContent = text || '';
      m.style.color = ok ? 'var(--ok)' : 'var(--bad)';
    }
  
    function safeHref(url) {
      try {
        var u = new URL(String(url || '').trim());
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
      } catch (e) { return ''; }
    }
  
    function el(tag, text, cls) {
      var n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    }
  
    function metaRow(dl, label, valueNode) {
      dl.appendChild(el('dt', label));
      var dd = document.createElement('dd');
      dd.appendChild(valueNode);
      dl.appendChild(dd);
    }
  
    function renderStore(s) {
      var card = el('article', null, 'card');
      var head = el('div', null, 'row');
      var title = el('strong', s.name || '(senza nome)');
      title.style.flex = '1';
      head.appendChild(title);
      head.appendChild(el('span', STATUS_LABEL[s.verification_status] || s.verification_status, 'pill ' + s.verification_status));
      card.appendChild(head);
  
      var dl = el('dl', null, 'meta');
      metaRow(dl, 'Email', document.createTextNode(s.email || '-'));
      metaRow(dl, 'Telefono', document.createTextNode(s.phone || '-'));
      metaRow(dl, 'Tipo', document.createTextNode(s.business_type || '-'));
      metaRow(dl, 'Indirizzo', document.createTextNode([s.address, s.city].filter(Boolean).join(' - ') || '-'));
      var href = safeHref(s.website_url);
      if (href) {
        var a = el('a', s.website_url);
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
        metaRow(dl, 'Sito', a);
      } else {
        metaRow(dl, 'Sito', document.createTextNode('-'));
      }
      metaRow(dl, 'Note iscrizione', document.createTextNode(s.internal_notes || '-'));
      metaRow(dl, 'Iscritto il', document.createTextNode(s.created_at ? new Date(s.created_at).toLocaleString('it-IT') : '-'));
      card.appendChild(dl);
  
      var noteLabel = el('label', 'Nota per il negozio (visibile al titolare, max 500 caratteri)');
      var note = document.createElement('textarea');
      note.rows = 2; note.maxLength = 500; note.value = s.verification_note || '';
      noteLabel.appendChild(note);
      card.appendChild(noteLabel);
  
      var actions = el('div', null, 'row');
      actions.style.marginTop = '12px';
      [['verified', 'Approva', 'ok'], ['rejected', 'Rifiuta', 'bad'], ['pending', 'Rimetti in attesa', 'ghost']].forEach(function (a) {
        if (a[0] === s.verification_status) return;
        var b = el('button', a[1], a[2]);
        b.type = 'button';
        b.addEventListener('click', function () { decide(s, a[0], note.value, b); });
        actions.appendChild(b);
      });
      card.appendChild(actions);
      return card;
    }
  
    async function decide(store, status, note, btn) {
      var verb = status === 'verified' ? 'approvare' : status === 'rejected' ? 'rifiutare' : 'rimettere in attesa';
      if (!window.confirm('Vuoi ' + verb + ' "' + store.name + '"?')) return;
      btn.disabled = true;
      var res = await client.rpc('admin_set_store_verification', { p_store_id: store.id, p_status: status, p_note: note || null });
      if (res.error) {
        btn.disabled = false;
        setMsg('Operazione non riuscita: ' + res.error.message, false);
        return;
      }
      setMsg('Fatto: ' + store.name + ' -> ' + STATUS_LABEL[status], true);
      load();
    }
  
    async function load() {
      var f = $('filter').value;
      var res = await client.rpc('admin_list_stores_for_review', { p_status: f === 'all' ? null : f });
      var list = $('list');
      list.textContent = '';
      if (res.error) {
        setMsg('Impossibile caricare l\'elenco (serve un account admin): ' + res.error.message, false);
        return;
      }
      if (!res.data || !res.data.length) {
        list.appendChild(el('p', 'Nessun negozio in questo elenco.', 'sub'));
        return;
      }
      res.data.forEach(function (s) { list.appendChild(renderStore(s)); });
    }
  
    function showApp(on) {
      $('loginBox').classList.toggle('hidden', on);
      $('appBox').classList.toggle('hidden', !on);
    }
  
    $('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      setMsg('');
      var res = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      $('password').value = '';
      if (res.error) { setMsg('Accesso non riuscito.', false); return; }
      showApp(true);
      load();
    });
    $('filter').addEventListener('change', load);
    $('reload').addEventListener('click', load);
    $('logout').addEventListener('click', async function () {
      await client.auth.signOut();
      $('list').textContent = '';
      showApp(false);
    });
  
    client.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) { showApp(true); load(); }
    });
  })();