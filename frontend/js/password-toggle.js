/*
 * password-toggle.js: aggiunge l'icona "occhio" a ogni campo password del sito.
 * Funziona da solo: guarda la pagina e, appena compare un <input type="password">
 * (anche dentro popup e form creati dopo), lo avvolge e ci mette accanto il bottone.
 * Nessun handler inline, quindi compatibile con la CSP (script-src 'self').
 */
(function () {
    'use strict';
  
    var STYLE_ID = 'dc-pw-style';
    var CSS = [
      '.pw-wrap{position:relative;display:block;width:100%;min-width:0;flex:0 1 auto;}',
      '.pw-wrap>input{width:100% !important;box-sizing:border-box !important;padding-right:48px !important;}',
      '.pw-wrap>input::-ms-reveal,.pw-wrap>input::-ms-clear{display:none;}',
      '.pw-toggle{position:absolute;top:0;right:0;bottom:0;width:44px;margin:0;padding:0;',
      'display:flex;align-items:center;justify-content:center;border:0;background:transparent;',
      'color:#64748b;cursor:pointer;border-radius:0 10px 10px 0;box-shadow:none;}',
      '.pw-toggle:hover{color:#161616;}',
      '.pw-toggle:focus-visible{outline:2px solid #0f62fe;outline-offset:-2px;}',
      '.pw-toggle svg{width:20px;height:20px;display:block;pointer-events:none;}'
    ].join('');
  
    var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var ICON_SHOW = SVG_OPEN + '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
      '<circle cx="12" cy="12" r="3"/></svg>';
    var ICON_HIDE = SVG_OPEN + '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 5.06-5.94"/>' +
      '<path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a19.86 19.86 0 0 1-3.17 4.19"/>' +
      '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  
    function addStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
  
    function setState(btn, input, visible) {
      input.type = visible ? 'text' : 'password';
      btn.innerHTML = visible ? ICON_HIDE : ICON_SHOW;
      btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
      btn.setAttribute('aria-label', visible ? 'Nascondi password' : 'Mostra password');
      btn.title = visible ? 'Nascondi password' : 'Mostra password';
    }
  
    function enhance(input) {
      if (!input || input.getAttribute('data-pw-toggle') === '1') return;
      if (!input.parentNode) return;
      input.setAttribute('data-pw-toggle', '1');
  
      var hadFocus = document.activeElement === input;
      var selStart = null, selEnd = null;
      if (hadFocus) { try { selStart = input.selectionStart; selEnd = input.selectionEnd; } catch (e) {} }
  
      var wrap = document.createElement('span');
      wrap.className = 'pw-wrap';
      // Se l'input aveva margini scritti nello style, passano al contenitore:
      // così lo spazio sotto il campo resta uguale e il bottone resta centrato.
      ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].forEach(function (p) {
        if (input.style[p]) { wrap.style[p] = input.style[p]; input.style[p] = ''; }
      });
  
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      setState(btn, input, false);
  
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      wrap.appendChild(btn);
  
      if (hadFocus) {
        input.focus();
        try { if (selStart !== null) input.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  
    function scan(root) {
      if (!root || root.nodeType !== 1) return;
      if (root.matches && root.matches('input[type="password"]')) enhance(root);
      if (root.querySelectorAll) {
        var list = root.querySelectorAll('input[type="password"]');
        for (var i = 0; i < list.length; i++) enhance(list[i]);
      }
    }
  
    function init() {
      addStyles();
  
      // Un tocco sull'occhio non deve togliere il focus al campo (sul telefono
      // chiuderebbe la tastiera).
      document.addEventListener('mousedown', function (e) {
        if (e.target.closest && e.target.closest('.pw-toggle')) e.preventDefault();
      });
  
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.pw-toggle');
        if (!btn) return;
        var input = btn.parentNode && btn.parentNode.querySelector('input');
        if (!input) return;
        var start = null, end = null;
        try { start = input.selectionStart; end = input.selectionEnd; } catch (err) {}
        setState(btn, input, input.type === 'password');
        if (document.activeElement === input) {
          try { if (start !== null) input.setSelectionRange(start, end); } catch (err) {}
        }
      });
  
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) scan(added[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
  
      scan(document.documentElement);
    }
  
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();