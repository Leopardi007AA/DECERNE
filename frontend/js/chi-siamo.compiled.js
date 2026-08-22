const {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback
} = React;
const PASSI = [{
  tema: "utente",
  titolo: "Apri DECERNE",
  testo: "Nessuna registrazione complicata: in pochi secondi vedi le offerte vicino a te.",
  tile: {
    emoji: "🥬",
    kicker: "Ortofrutta",
    name: "Mele Golden 1kg",
    oldPrice: "2,49",
    newPrice: "1,59",
    badge: "-36%"
  }
}, {
  tema: "utente",
  titolo: "Cerca il prodotto",
  testo: "Scrivi cosa ti serve, oppure sfoglia le offerte per categoria.",
  tile: {
    emoji: "🥩",
    kicker: "Macelleria",
    name: "Petto di pollo 500g",
    oldPrice: "4,90",
    newPrice: "3,20",
    badge: "-35%"
  }
}, {
  tema: "utente",
  titolo: "Confronta i prezzi",
  testo: "Vedi subito quale negozio vende quel prodotto al prezzo più basso, con la mappa per arrivarci.",
  tile: {
    emoji: "🥫",
    kicker: "Dispensa",
    name: "Pasta di semola 1kg",
    oldPrice: "1,80",
    newPrice: "0,99",
    badge: "-45%"
  }
}, {
  tema: "utente",
  titolo: "Salva la tua lista",
  testo: "Metti le offerte nel carrello, oppure usa la lista della spesa intelligente: scrivi il nome del prodotto che ti serve e DECERNE lo trova per te tra le offerte disponibili.",
  tile: {
    emoji: "🧊",
    kicker: "Surgelati",
    name: "Piatto pronto 400g",
    oldPrice: "3,50",
    newPrice: "2,49",
    badge: "-29%"
  }
}, {
  tema: "negozio",
  titolo: "Crei il profilo del tuo negozio",
  testo: "Inserisci nome, indirizzo e orari: in pochi minuti sei visibile a tutti i clienti della zona.",
  tile: {
    emoji: "🏪",
    kicker: "Il tuo negozio",
    name: "Profilo pubblicato",
    oldPrice: null,
    newPrice: null,
    badge: "Attivo"
  }
}, {
  tema: "negozio",
  titolo: "Pubblichi le offerte",
  testo: "Aggiungi i prodotti in promozione, con foto e prezzo. Puoi anche importarli tutti insieme da un file.",
  tile: {
    emoji: "🏷️",
    kicker: "Nuova offerta",
    name: "Import da file",
    oldPrice: null,
    newPrice: null,
    badge: "42 prodotti"
  }
}, {
  tema: "negozio",
  titolo: "I clienti ti trovano",
  testo: "Chi cerca quel prodotto nella tua zona vede la tua offerta e viene direttamente da te.",
  tile: {
    emoji: "📍",
    kicker: "Oggi",
    name: "Nuove visualizzazioni",
    oldPrice: null,
    newPrice: null,
    badge: "+128"
  }
}, {
  tema: "negozio",
  titolo: "Segui i risultati",
  testo: "Dalla tua dashboard vedi quante persone hanno visto e cliccato le tue offerte, in tempo reale.",
  tile: {
    emoji: "📊",
    kicker: "Dashboard",
    name: "Interazioni settimana",
    oldPrice: null,
    newPrice: null,
    badge: "Live"
  }
}, {
  tema: "differenza",
  titolo: "Perché DECERNE è diverso",
  testo: "Non un volantino digitale: offerte aggiornate in tempo reale, mappa integrata, lista della spesa intelligente e statistiche vere per chi vende.",
  tile: {
    emoji: "⚡",
    kicker: "DECERNE",
    name: "Tempo reale + Mappa",
    oldPrice: null,
    newPrice: null,
    badge: "Unico"
  }
}, {
  tema: "cta",
  titolo: "Porta il tuo negozio su DECERNE",
  testo: "Attivazione in pochi minuti, primi risultati visibili da subito. Scegli il piano adatto al tuo negozio.",
  tile: {
    emoji: "🚀",
    kicker: "Abbonamento",
    name: "Standard → Enterprise",
    oldPrice: null,
    newPrice: null,
    badge: "Inizia ora"
  }
}];
const THEME_LABEL = {
  utente: "Per chi fa la spesa",
  negozio: "Per il tuo negozio",
  differenza: "Cosa ci differenzia",
  cta: "Abbonati"
};

// 60 tessere in spirale elicoidale: 10 per giro, 6 giri
// Spacing: 105px, Angolo: 36°
const TOTAL_TILES = 60;
const TILES_PER_RING = 10;
const ANGLE_STEP = 36;
const VERTICAL_STEP = 105;
const RADIUS = 340;
const N = PASSI.length;
const CYLINDER_TILES = Array.from({
  length: TOTAL_TILES
}, (_, i) => {
  const products = [{
    emoji: "🥬",
    kicker: "Ortofrutta",
    name: "Mele Golden 1kg",
    oldPrice: "2,49",
    newPrice: "1,59",
    badge: "-36%"
  }, {
    emoji: "💻",
    kicker: "Elettronica",
    name: 'Computer 15"',
    oldPrice: "899",
    newPrice: "739",
    badge: "-18%"
  }, {
    emoji: "🧴",
    kicker: "Igiene",
    name: "Detersivo bucato",
    oldPrice: "12,90",
    newPrice: "9,40",
    badge: "-27%"
  }, {
    emoji: "👟",
    kicker: "Sport",
    name: "Scarpe sportive",
    oldPrice: "89",
    newPrice: "67",
    badge: "-25%"
  }, {
    emoji: "🍷",
    kicker: "Bevande",
    name: "Vino rosso DOC",
    oldPrice: "12,90",
    newPrice: "9,30",
    badge: "-28%"
  }, {
    emoji: "🧸",
    kicker: "Bambini",
    name: "Peluche grande",
    oldPrice: "29",
    newPrice: "22",
    badge: "-24%"
  }, {
    emoji: "🥩",
    kicker: "Macelleria",
    name: "Petto di pollo 500g",
    oldPrice: "4,90",
    newPrice: "3,20",
    badge: "-35%"
  }, {
    emoji: "📱",
    kicker: "Elettronica",
    name: "Smartphone 128GB",
    oldPrice: "699",
    newPrice: "545",
    badge: "-22%"
  }, {
    emoji: "🧺",
    kicker: "Igiene",
    name: "Detersivo lavatrice",
    oldPrice: "14,50",
    newPrice: "12,00",
    badge: "-17%"
  }, {
    emoji: "🏋️",
    kicker: "Fitness",
    name: "Set manubri 20kg",
    oldPrice: "59",
    newPrice: "47",
    badge: "-20%"
  }, {
    emoji: "🥤",
    kicker: "Bevande",
    name: "Acqua minerale x6",
    oldPrice: "3,50",
    newPrice: "2,80",
    badge: "-20%"
  }, {
    emoji: "🎨",
    kicker: "Bambini",
    name: "Set colori 48pz",
    oldPrice: "19",
    newPrice: "15",
    badge: "-21%"
  }, {
    emoji: "🥫",
    kicker: "Dispensa",
    name: "Pasta di semola 1kg",
    oldPrice: "1,80",
    newPrice: "0,99",
    badge: "-45%"
  }, {
    emoji: "🎧",
    kicker: "Audio",
    name: "Cuffie wireless",
    oldPrice: "199",
    newPrice: "139",
    badge: "-30%"
  }, {
    emoji: "🧻",
    kicker: "Igiene",
    name: "Carta igienica x12",
    oldPrice: "8,90",
    newPrice: "7,00",
    badge: "-21%"
  }, {
    emoji: "🧘",
    kicker: "Fitness",
    name: "Tappetino yoga",
    oldPrice: "35",
    newPrice: "26",
    badge: "-26%"
  }, {
    emoji: "🍺",
    kicker: "Bevande",
    name: "Birra artigianale",
    oldPrice: "4,50",
    newPrice: "3,40",
    badge: "-24%"
  }, {
    emoji: "📚",
    kicker: "Libri",
    name: "Libro bestseller",
    oldPrice: "19,90",
    newPrice: "15,90",
    badge: "-20%"
  }, {
    emoji: "🧊",
    kicker: "Surgelati",
    name: "Piatto pronto 400g",
    oldPrice: "3,50",
    newPrice: "2,49",
    badge: "-29%"
  }, {
    emoji: "🖥️",
    kicker: "Elettronica",
    name: 'Monitor 27"',
    oldPrice: "349",
    newPrice: "293",
    badge: "-16%"
  }, {
    emoji: "🛏️",
    kicker: "Casa",
    name: "Set lenzuola",
    oldPrice: "45",
    newPrice: "36",
    badge: "-20%"
  }, {
    emoji: "👕",
    kicker: "Moda",
    name: "T-shirt premium",
    oldPrice: "29",
    newPrice: "22",
    badge: "-24%"
  }, {
    emoji: "🍾",
    kicker: "Bevande",
    name: "Prosecco DOCG",
    oldPrice: "14,90",
    newPrice: "11,90",
    badge: "-20%"
  }, {
    emoji: "🧩",
    kicker: "Giochi",
    name: "Puzzle 1000 pezzi",
    oldPrice: "15",
    newPrice: "11",
    badge: "-27%"
  }, {
    emoji: "🏪",
    kicker: "Il tuo negozio",
    name: "Profilo pubblicato",
    oldPrice: null,
    newPrice: null,
    badge: "Attivo"
  }, {
    emoji: "⌚",
    kicker: "Wearable",
    name: "Smartwatch",
    oldPrice: "299",
    newPrice: "257",
    badge: "-14%"
  }, {
    emoji: "🪴",
    kicker: "Casa",
    name: "Pianta ornamentale",
    oldPrice: "19,90",
    newPrice: "14,90",
    badge: "-25%"
  }, {
    emoji: "👖",
    kicker: "Moda",
    name: "Jeans slim fit",
    oldPrice: "69",
    newPrice: "52",
    badge: "-25%"
  }, {
    emoji: "🥃",
    kicker: "Bevande",
    name: "Whiskey 12 anni",
    oldPrice: "39",
    newPrice: "31",
    badge: "-21%"
  }, {
    emoji: "🐕",
    kicker: "Pet",
    name: "Crocchette cane 3kg",
    oldPrice: "24,90",
    newPrice: "19,90",
    badge: "-20%"
  }, {
    emoji: "🏷️",
    kicker: "Nuova offerta",
    name: "Import da file",
    oldPrice: null,
    newPrice: null,
    badge: "42 prodotti"
  }, {
    emoji: "🎮",
    kicker: "Gaming",
    name: "Controller gaming",
    oldPrice: "69",
    newPrice: "53",
    badge: "-23%"
  }, {
    emoji: "🧹",
    kicker: "Casa",
    name: "Scopa elettrica",
    oldPrice: "129",
    newPrice: "99",
    badge: "-23%"
  }, {
    emoji: "🧥",
    kicker: "Moda",
    name: "Giacca impermeabile",
    oldPrice: "129",
    newPrice: "97",
    badge: "-25%"
  }, {
    emoji: "🍕",
    kicker: "Surgelati",
    name: "Pizza surgelata",
    oldPrice: "4,50",
    newPrice: "3,30",
    badge: "-27%"
  }, {
    emoji: "🐈",
    kicker: "Pet",
    name: "Lettiera agglomerante",
    oldPrice: "12,90",
    newPrice: "9,90",
    badge: "-23%"
  }, {
    emoji: "📍",
    kicker: "Oggi",
    name: "Nuove visualizzazioni",
    oldPrice: null,
    newPrice: null,
    badge: "+128"
  }, {
    emoji: "📷",
    kicker: "Fotografia",
    name: "Fotocamera mirrorless",
    oldPrice: "1299",
    newPrice: "1039",
    badge: "-20%"
  }, {
    emoji: "🕯️",
    kicker: "Casa",
    name: "Candele profumate",
    oldPrice: "15,90",
    newPrice: "11,90",
    badge: "-25%"
  }, {
    emoji: "👜",
    kicker: "Accessori",
    name: "Borsa tote",
    oldPrice: "49",
    newPrice: "37",
    badge: "-24%"
  }, {
    emoji: "🍝",
    kicker: "Gourmet",
    name: "Sugo artigianale",
    oldPrice: "5,90",
    newPrice: "4,40",
    badge: "-25%"
  }, {
    emoji: "🦴",
    kicker: "Pet",
    name: "Osso giocattolo",
    oldPrice: "8,90",
    newPrice: "6,90",
    badge: "-22%"
  }, {
    emoji: "📊",
    kicker: "Dashboard",
    name: "Interazioni settimana",
    oldPrice: null,
    newPrice: null,
    badge: "Live"
  }, {
    emoji: "💾",
    kicker: "Storage",
    name: "SSD 1TB",
    oldPrice: "89",
    newPrice: "69",
    badge: "-22%"
  }, {
    emoji: "🪞",
    kicker: "Casa",
    name: "Specchio decorativo",
    oldPrice: "39",
    newPrice: "29",
    badge: "-26%"
  }, {
    emoji: "🕶️",
    kicker: "Accessori",
    name: "Occhiali da sole",
    oldPrice: "89",
    newPrice: "67",
    badge: "-25%"
  }, {
    emoji: "🥗",
    kicker: "Gourmet",
    name: "Insalata pronta",
    oldPrice: "4,20",
    newPrice: "3,20",
    badge: "-24%"
  }, {
    emoji: "🐟",
    kicker: "Pet",
    name: "Cibo gatto umido",
    oldPrice: "9,90",
    newPrice: "7,90",
    badge: "-20%"
  }, {
    emoji: "⚡",
    kicker: "DECERNE",
    name: "Tempo reale + Mappa",
    oldPrice: null,
    newPrice: null,
    badge: "Unico"
  }, {
    emoji: "🔌",
    kicker: "Accessori",
    name: "Hub USB-C",
    oldPrice: "59",
    newPrice: "44",
    badge: "-25%"
  }, {
    emoji: "🧽",
    kicker: "Casa",
    name: "Spugne multiuso x10",
    oldPrice: "4,50",
    newPrice: "3,20",
    badge: "-29%"
  }, {
    emoji: "🎓",
    kicker: "Scuola",
    name: "Zaino ergonomico",
    oldPrice: "49",
    newPrice: "39",
    badge: "-20%"
  }, {
    emoji: "🥐",
    kicker: "Pasticceria",
    name: "Croissant x4",
    oldPrice: "3,90",
    newPrice: "2,90",
    badge: "-26%"
  }, {
    emoji: "✏️",
    kicker: "Scuola",
    name: "Astuccio completo",
    oldPrice: "15",
    newPrice: "12",
    badge: "-20%"
  }, {
    emoji: "🧯",
    kicker: "Sicurezza",
    name: "Estintore domestico",
    oldPrice: "29",
    newPrice: "23",
    badge: "-21%"
  }, {
    emoji: "🚀",
    kicker: "Abbonamento",
    name: "Standard → Enterprise",
    oldPrice: null,
    newPrice: null,
    badge: "Inizia ora"
  }, {
    emoji: "🖱️",
    kicker: "Accessori",
    name: "Mouse wireless",
    oldPrice: "49",
    newPrice: "39",
    badge: "-20%"
  }, {
    emoji: "🏊",
    kicker: "Sport",
    name: "Costume da bagno",
    oldPrice: "45",
    newPrice: "34",
    badge: "-24%"
  }, {
    emoji: "🎾",
    kicker: "Sport",
    name: "Racchetta tennis",
    oldPrice: "149",
    newPrice: "119",
    badge: "-20%"
  }, {
    emoji: "🍫",
    kicker: "Dolci",
    name: "Cioccolato fondente",
    oldPrice: "3,90",
    newPrice: "2,69",
    badge: "-31%"
  }, {
    emoji: "🐟",
    kicker: "Pescheria",
    name: "Filetto di salmone",
    oldPrice: "16,50",
    newPrice: "13,40",
    badge: "-19%"
  }, {
    emoji: "🍞",
    kicker: "Panetteria",
    name: "Pane fresco",
    oldPrice: "2,50",
    newPrice: "2,25",
    badge: "-10%"
  }, {
    emoji: "☕",
    kicker: "Dispensa",
    name: "Caffè macinato 1kg",
    oldPrice: "8,90",
    newPrice: "5,99",
    badge: "-33%"
  }];
  return {
    ...products[i % products.length],
    id: i,
    angleDeg: i * ANGLE_STEP,
    yPos: i * VERTICAL_STEP
  };
});
function App() {
  const trackRef = useRef(null);
  const rafRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  useEffect(() => {
    const onMessage = event => {
      const data = event.data;
      if (data && data.source === 'decerne' && data.type === 'drawerState') {
        setIsDrawerOpen(!!data.open);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      setProgress(p);
    });
  }, []);
  useEffect(() => {
    handleScroll();
    window.addEventListener("scroll", handleScroll, {
      passive: true
    });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll]);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Rimpicciolisce la spirale sugli schermi piccoli, così resta tutta visibile
  const cylinderScale = viewportWidth <= 480 ? 0.48 : viewportWidth <= 768 ? 0.6 : viewportWidth <= 1024 ? 0.82 : 1;
  // Oltre ai pannelli, la sezione ha uno spazio di scroll extra (BUFFER_VH) dedicato
  // a far sparire la scena (spirale + pannello) mentre è ancora ferma/agganciata a schermo,
  // così quando si stacca per far entrare il footer è già invisibile: niente più sovrapposizioni.
  const BUFFER_VH = 70;
  const CONTENT_VH = (N - 1) * 100;
  const contentFraction = CONTENT_VH / (CONTENT_VH + BUFFER_VH);
  let rawProgress;
  let sceneOpacity;
  if (progress <= contentFraction) {
    rawProgress = (progress / contentFraction) * (N - 1);
    sceneOpacity = 1;
  } else {
    rawProgress = N - 1;
    const bufferP = (progress - contentFraction) / (1 - contentFraction);
    sceneOpacity = Math.max(0, 1 - bufferP);
  }
  // "Sosta" leggermente più a lungo quando si arriva esattamente su un pannello:
  // rallenta l'avanzamento vicino agli indici interi, lo accelera tra un pannello e l'altro.
  // Il percorso totale (0 -> N-1) resta identico, cambia solo la velocità percepita.
  const PANEL_SETTLE = 0.3;
  const warpedProgress = rawProgress - (PANEL_SETTLE / (2 * Math.PI)) * Math.sin(2 * Math.PI * rawProgress);
  const activeIndex = Math.min(N - 1, Math.round(rawProgress));

  // 60 tessere / 10 slide = 6 tessere per slide
  // Ogni slide avanza di 6 tessere = 6 * 36° = 216° di rotazione
  const tilesPerSlide = TOTAL_TILES / N;
  const rotationPerSlide = tilesPerSlide * ANGLE_STEP;
  const cylinderRotation = -warpedProgress * rotationPerSlide;
  const cylinderY = -warpedProgress * tilesPerSlide * VERTICAL_STEP;
  const scrollToTrack = () => {
    trackRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
  };
  const isMobileNav = viewportWidth <= 768;

  // La pagina Chi Siamo vive normalmente dentro l'iframe di index.html:
  // quando possibile deleghiamo le azioni alle funzioni globali della pagina
  // principale (setMode/openDrawer), altrimenti ripieghiamo su una navigazione diretta.
  const parentWin = window.parent && window.parent !== window ? window.parent : null;
  const handleLogoClick = () => {
    // Come il logo di Home Utenti, deve ricaricare la pagina principale
    // (che di default riparte su Home Utenti), non solo l'iframe di Chi Siamo.
    if (parentWin) {
      parentWin.location.reload();
    } else {
      window.location.href = 'index.html';
    }
  };
  const goToParentMode = mode => {
    try {
      if (parentWin && typeof parentWin.setMode === 'function') {
        parentWin.setMode(mode);
        return;
      }
    } catch (e) {}
    window.location.href = 'index.html';
  };
  const handleOfferteClick = () => goToParentMode('user');
  const handleNegoziClick = () => goToParentMode('store');
  const handleChiSiamoClick = () => goToParentMode('chisiamo');
  const handleHamburgerClick = () => {
    try {
      if (parentWin && typeof parentWin.openDrawer === 'function' && typeof parentWin.closeDrawer === 'function') {
        if (isDrawerOpen) {
          parentWin.closeDrawer();
        } else {
          parentWin.openDrawer();
        }
        return;
      }
    } catch (e) {}
    window.location.href = 'index.html';
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "dc-app"
  }, /*#__PURE__*/React.createElement("nav", {
    className: "dc-navbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dc-navbar-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dc-logo",
    onClick: handleLogoClick
  }, "DECERNE")), !isMobileNav && /*#__PURE__*/React.createElement("div", {
    className: "dc-nav-links"
  }, /*#__PURE__*/React.createElement("span", {
    onClick: handleOfferteClick
  }, "Offerte"), /*#__PURE__*/React.createElement("span", {
    onClick: handleNegoziClick
  }, "Negozi"), /*#__PURE__*/React.createElement("span", {
    onClick: handleChiSiamoClick
  }, "Chi Siamo")), /*#__PURE__*/React.createElement("div", {
    className: "dc-navbar-side dc-navbar-side-right"
  }, isMobileNav && /*#__PURE__*/React.createElement("button", {
    className: `dc-hamburger${isDrawerOpen ? ' open' : ''}`,
    onClick: handleHamburgerClick,
    "aria-label": "Apri menu"
  }, /*#__PURE__*/React.createElement("div", { className: "hamburger-icon" }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null))))), /*#__PURE__*/React.createElement("section", {
    className: "dc-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dc-hero-badge"
  }, "La spesa intelligente, semplice per tutti"), /*#__PURE__*/React.createElement("h1", null, "Il risparmio", /*#__PURE__*/React.createElement("br", null), "a portata di clic"), /*#__PURE__*/React.createElement("p", null, "DECERNE mette insieme, in un unico posto, tutte le offerte dei supermercati vicino a te. Niente più volantini da sfogliare: apri il sito, guardi cosa costa meno, vai a fare la spesa."), /*#__PURE__*/React.createElement("div", {
    className: "dc-hero-scroll",
    onClick: scrollToTrack
  }, "Scopri come funziona", /*#__PURE__*/React.createElement("div", {
    className: "dc-arrow"
  }))), /*#__PURE__*/React.createElement("section", {
    ref: trackRef,
    className: "dc-track",
    style: {
      height: `${N * 100 + BUFFER_VH}vh`
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dc-sticky"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dc-grid-bg"
  }), /*#__PURE__*/React.createElement("div", {
    className: "dc-cylinder-container",
    style: {
      transform: `scale(${cylinderScale}) translate(-50%, -50%) translateY(${cylinderY}px) rotateY(${cylinderRotation}deg)`
    }
  }, CYLINDER_TILES.map(tile => {
    const angleWorld = (tile.angleDeg + cylinderRotation) * Math.PI / 180;
    const isFront = Math.cos(angleWorld) > -0.1;
    const x = Math.sin(tile.angleDeg * Math.PI / 180) * RADIUS;
    const z = Math.cos(tile.angleDeg * Math.PI / 180) * RADIUS;
    return /*#__PURE__*/React.createElement("div", {
      key: tile.id,
      className: `dc-cylinder-tile ${isFront ? 'front' : 'back'}`,
      style: {
        transform: `
                          translateY(${tile.yPos}px) 
                          translateX(${x}px) 
                          translateZ(${z}px) 
                          rotateY(${tile.angleDeg}deg)
                        `
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "tile-content"
    }, /*#__PURE__*/React.createElement("div", {
      className: "ct-emoji"
    }, tile.emoji), /*#__PURE__*/React.createElement("div", {
      className: "ct-mid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "ct-kicker"
    }, tile.kicker), /*#__PURE__*/React.createElement("div", {
      className: "ct-name"
    }, tile.name), tile.oldPrice && /*#__PURE__*/React.createElement("div", {
      className: "ct-price-old"
    }, "€", tile.oldPrice), tile.newPrice && /*#__PURE__*/React.createElement("div", {
      className: "ct-price-new"
    }, "€", tile.newPrice)), /*#__PURE__*/React.createElement("div", {
      className: "ct-badge"
    }, tile.badge)));
  })), /*#__PURE__*/React.createElement("div", {
    className: "dc-slide-panel"
  }, PASSI.map((step, i) => {
    const dist = warpedProgress - i;
    const isActive = Math.abs(dist) < 0.5;
    let transform = 'translateX(120px) rotateY(-35deg) scale(0.8)';
    let opacity = 0;
    let zIndex = 0;
    if (Math.abs(dist) < 1.0) {
      const t = 1 - Math.abs(dist);
      const enterDir = dist < 0 ? 1 : -1;
      transform = `translateX(${enterDir * (1 - t) * 60}px) rotateY(${enterDir * (1 - t) * 20}deg) scale(${0.8 + t * 0.2})`;
      opacity = t * t;
      zIndex = Math.round(t * 10);
    }
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "dc-slide-card",
      style: {
        transform,
        opacity,
        zIndex,
        pointerEvents: isActive ? 'auto' : 'none'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "dc-slide-count"
    }, String(i + 1).padStart(2, "0"), " / ", String(N).padStart(2, "0")), /*#__PURE__*/React.createElement("div", {
      className: "dc-slide-theme"
    }, THEME_LABEL[step.tema]), /*#__PURE__*/React.createElement("h3", null, step.titolo), /*#__PURE__*/React.createElement("p", null, step.testo), step.tema === "cta" && /*#__PURE__*/React.createElement("button", {
      className: "dc-cta-btn",
      onClick: () => goToParentMode('store')
    }, "Scopri i piani per il tuo negozio"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "dc-rail"
  }, PASSI.map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: i <= activeIndex ? "done" : ""
  }))))), /*#__PURE__*/React.createElement("footer", {
    className: "dc-footer",
    dangerouslySetInnerHTML: {
      __html: "<div class=\"dc-footer-inner\">" +
        "<div class=\"dc-footer-brand\">DECERNE</div>" +
        "<p class=\"dc-footer-legal\">[RAGIONE SOCIALE] &middot; P.IVA [PARTITA IVA] &middot; Sede: [INDIRIZZO SEDE LEGALE]<br>" +
        "PEC: <a href=\"mailto:[PEC]\">[PEC]</a> &middot; Assistenza: <a href=\"mailto:supporto@decerne.it\">supporto@decerne.it</a></p>" +
        "<nav class=\"dc-footer-links\" aria-label=\"Link legali\">" +
        "<a href=\"legale.html#termini\">Termini</a>" +
        "<a href=\"legale.html#privacy\">Privacy</a>" +
        "<a href=\"legale.html#cookie\">Cookie</a>" +
        "<a href=\"legale.html#rimborsi\">Rimborsi</a>" +
        "<a href=\"legale.html#recesso\">Recesso</a>" +
        "</nav>" +
        "<p class=\"dc-footer-copy\">&copy; 2026 DECERNE. Tutti i diritti riservati.</p>" +
        "</div>"
    }
  }));
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(/*#__PURE__*/React.createElement(App, null));