/*
 * handlers.js — sostituisce gli handler inline (onclick="...", onchange="..." ecc.).
 * Con una CSP senza 'unsafe-inline' il browser blocca gli attributi onclick: qui gli
 * attributi si chiamano data-onclick / data-onchange / data-oninput / data-onsubmit e
 * vengono letti SENZA eval: solo chiamate a funzioni globali con argomenti letterali.
 * Va caricato PRIMA di main.js.
 */
(function (root) {
    'use strict';
  
    var ATTR_TO_PROP = {
      'data-onclick': 'onclick',
      'data-onchange': 'onchange',
      'data-oninput': 'oninput',
      'data-onsubmit': 'onsubmit'
    };
    var ATTRS = Object.keys(ATTR_TO_PROP);
    var SELECTOR = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
    var BLOCKED = { eval: 1, Function: 1, setTimeout: 1, setInterval: 1, execScript: 1,
                    fetch: 1, XMLHttpRequest: 1, __proto__: 1, constructor: 1, prototype: 1 };
    var cache = Object.create(null);
  
    // Divide "a; b" o "x, y" solo fuori da apici e parentesi.
    function splitTop(str, sep) {
      var out = [], cur = '', q = null, depth = 0, i, c;
      for (i = 0; i < str.length; i++) {
        c = str[i];
        if (q) {
          cur += c;
          if (c === '\\') { cur += str[++i] || ''; } else if (c === q) { q = null; }
          continue;
        }
        if (c === "'" || c === '"') { q = c; cur += c; continue; }
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim() !== '') out.push(cur);
      return out;
    }
  
    function balanced(str) {
      var q = null, depth = 0, i, c;
      for (i = 0; i < str.length; i++) {
        c = str[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
        if (c === "'" || c === '"') { q = c; continue; }
        if (c === '(') depth++;
        if (c === ')' && --depth < 0) return false;
      }
      return depth === 0 && q === null;
    }
  
    var ALLOWED = Object.create(null);
    ('activatePlan bulkDeleteOffers bulkSchedulePublish bulkSetOfferStatus cancelScheduledPlanChange clickElementById closeCsvModal closeFullPageModal closeOfferModal closePartnerSidebar closePreview closeStoreInfoPopup closeStoreInfoPopupOnBackdrop closeStoreProfile confirmCsvImport connectEcommercePlatform copyLocationId deleteOffer disconnectEcommercePlatform downloadTemplateJSON editOffer evaluateSmartSavings exportOffersToCSV goToStoreStep handleCsvFileSelect handleJSONImport handleNewOfferClick handleSmartListFieldInput logoutPartner logoutUser openAddLocationModal openBrowseStoresMap openCartMapView openDataUrl openEmailContact openLocationGoogleMapsHelper openProductDetail openProfileFromDrawer openRegisterFromDrawer openSharedListMapView openSmartShoppingListModal openSmartShoppingListModalIfReady openStoreInGoogleMaps openStoreProfile openUpgradeChoiceModal promptPasswordThenDeleteAccount regeneratePartnerApiKey removeClosest removeFromCart removeLocation removeParentElement renderCartContent renderEcomCredentialFields renderForgotPasswordForm renderLoginForm renderStoreForgotPasswordForm resendOnboardingOtp restoreOffer saveIntegrationProvider saveLocationCoordinates saveLocationEdit saveOfferFromIdField saveShippingTerritories saveStoreProfile saveToShoppingList searchSmartShoppingList setBillingCycle setMode setOfferStatusPill setPreviewDevice setPrimaryLocation shareOffer shareShoppingList showExpiredStatusInfo showRegisterForm showStatInfo showStoreInfoPopup showStoreLogin signInWithProvider startPlanDirect startTrial stopCartMapTracking switchStoreTab switchToAnnual toggleBulkScheduleFields toggleCartVoice toggleFollowMe toggleKebabMenu toggleOfferSelection toggleSelectAllOffersFromHeader toggleStatoPubblicazioneMenu toggleStoreProfileLocations tourOpenCartMapView traceSmartListOnMap updateSmartListQuantityFromInput')
      .split(' ').forEach(function (n) { ALLOWED[n] = 1; });

    function resolvePath(path, el, ev, win) {
      var parts = path.split('.'), base = parts[0], obj;
      if (base === 'this') obj = el;
      else if (base === 'event') obj = ev;
      else if (base === 'window') obj = win;
      else obj = win[base];
      for (var i = 1; i < parts.length; i++) {
        if (BLOCKED[parts[i]] === 1) throw new Error('segmento non consentito: ' + parts[i]);
        if (obj == null) return undefined;
        obj = obj[parts[i]];
      }
      return obj;
    }
  
    function parseArg(tok, el, ev, win) {
      tok = tok.trim();
      var m;
      if ((m = /^'((?:[^'\\]|\\[\s\S])*)'$/.exec(tok)) || (m = /^"((?:[^"\\]|\\[\s\S])*)"$/.exec(tok))) {
        return m[1].replace(/\\([\s\S])/g, '$1');
      }
      if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      if (tok === 'null') return null;
      if (tok === 'undefined') return undefined;
      if (tok === 'this') return el;
      if (tok === 'event') return ev;
      if (/^(this|event|window)(\.[A-Za-z_]\w*)+$/.test(tok)) return resolvePath(tok, el, ev, win);
      throw new Error('argomento non supportato: ' + tok);
    }
  
    function parseStatement(stmt, win) {
      var m;
      if ((m = /^return\s+(true|false)$/.exec(stmt))) {
        var val = m[1] === 'true';
        return function (el, ev, state) { state.ret = val; };
      }
      m = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([\s\S]*)\)$/.exec(stmt);
      if (!m) throw new Error('istruzione non supportata: ' + stmt);
      var path = m[1], argToks = splitTop(m[2], ',');
      if (/^(if|for|while|switch|function|return)$/.test(path)) throw new Error('istruzione non supportata: ' + stmt);
      if (!balanced(m[2])) throw new Error('parentesi non bilanciate: ' + stmt);
      var segs = path.split('.');
      segs.forEach(function (s) { if (BLOCKED[s] === 1) throw new Error('funzione non consentita: ' + s); });
      if (segs[0] !== 'event' && segs[0] !== 'this' && segs[0] !== 'window' && ALLOWED[segs[0]] !== 1) throw new Error('funzione non in allowlist: ' + segs[0]);
      return function (el, ev, state) {
        var args = argToks.map(function (t) { return parseArg(t, el, ev, win); });
        var thisObj, fn;
        if (segs[0] === 'event') {
          thisObj = ev; fn = ev[segs[1]];
          if (segs.length !== 2 || (segs[1] !== 'stopPropagation' && segs[1] !== 'preventDefault')) {
            throw new Error('metodo evento non consentito: ' + path);
          }
        } else if (segs.length === 1) {
          thisObj = win; fn = win[segs[0]];
        } else {
          thisObj = resolvePath(segs.slice(0, -1).join('.'), el, ev, win); fn = thisObj && thisObj[segs[segs.length - 1]];
        }
        if (typeof fn !== 'function') throw new Error('funzione non trovata: ' + path);
        fn.apply(thisObj, args);
      };
    }
  
    function compile(code, win) {
      if (cache[code]) return cache[code];
      var plan;
      try {
        plan = splitTop(code, ';').map(function (s) { return s.trim(); }).filter(Boolean)
          .map(function (s) { return parseStatement(s, win); });
      } catch (e) {
        if (root.console) console.warn('[handlers] handler ignorato (' + e.message + '):', code);
        plan = [];
      }
      var fn = function (ev) {
        var state = { ret: undefined };
        for (var i = 0; i < plan.length; i++) plan[i](this, ev, state);
        return state.ret;
      };
      cache[code] = fn;
      return fn;
    }
  
    function bind(el, win) {
      if (!el || el.nodeType !== 1) return;
      for (var i = 0; i < ATTRS.length; i++) {
        var attr = ATTRS[i];
        if (!el.hasAttribute(attr)) continue;
        var prop = ATTR_TO_PROP[attr], code = el.getAttribute(attr);
        var mine = el.__dcHandlers || (el.__dcHandlers = {});
        if (mine[prop] === code) continue;
        // Se un altro pezzo di codice ha già assegnato el.onclick = ..., non lo sovrascrive.
        if (el[prop] && !mine[prop]) continue;
        el[prop] = compile(code, win);
        mine[prop] = code;
      }
    }
  
    function scan(node, win) {
      if (!node || node.nodeType !== 1) return;
      if (node.matches && node.matches(SELECTOR)) bind(node, win);
      if (node.querySelectorAll) {
        var list = node.querySelectorAll(SELECTOR);
        for (var i = 0; i < list.length; i++) bind(list[i], win);
      }
    }
  
    function install(win) {
      var doc = win.document;
  
      // Subito dopo ogni innerHTML / insertAdjacentHTML gli handler sono già collegati:
      // il codice che legge o riassegna .onclick subito dopo trova lo stato giusto.
      var d = Object.getOwnPropertyDescriptor(win.Element.prototype, 'innerHTML');
      if (d && d.set) {
        Object.defineProperty(win.Element.prototype, 'innerHTML', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set: function (v) { d.set.call(this, v); scan(this, win); }
        });
      }
      var origIAH = win.Element.prototype.insertAdjacentHTML;
      win.Element.prototype.insertAdjacentHTML = function (pos, html) {
        origIAH.call(this, pos, html);
        scan((pos === 'beforebegin' || pos === 'afterend') ? (this.parentElement || this) : this, win);
      };
  
      // Rete di sicurezza per tutto il resto (createElement + setAttribute, outerHTML, cloneNode...).
      new win.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'attributes') { bind(r.target, win); continue; }
          for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j], win);
        }
      }).observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });
  
      // I link href="#" usati come "bottoni" non devono saltare in cima alla pagina.
      doc.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a[href="#"]');
        if (a) e.preventDefault();
      }, true);
  
      scan(doc.documentElement, win);
    }
  
    if (root.document && root.Element) install(root);
    root.__dcHandlers = { compile: compile, install: install, splitTop: splitTop };
  })(typeof window !== 'undefined' ? window : globalThis);