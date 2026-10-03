function openEmailContact(email, subject) {
  document.querySelector('.email-contact-overlay')?.remove();
  subject = subject || '';
  const encodedSubject = encodeURIComponent(subject);
  const mailtoHref = 'mailto:' + email + (subject ? '?subject=' + encodedSubject : '');
  const gmailHref = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(email) + (subject ? '&su=' + encodedSubject : '');

  const overlay = document.createElement('div');
  overlay.className = 'email-contact-overlay';

  const box = document.createElement('div');
  box.className = 'email-contact-box';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'email-contact-close';
  closeBtn.setAttribute('aria-label', 'Chiudi');
  closeBtn.textContent = '×';
  closeBtn.onclick = () => closePopup();

  const title = document.createElement('h3');
  title.textContent = 'Scrivi a Decerne';

  const addr = document.createElement('p');
  addr.className = 'email-contact-address';
  addr.textContent = email;

  const actions = document.createElement('div');
  actions.className = 'email-contact-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn';
  copyBtn.textContent = 'Copia indirizzo';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(email);
    copyBtn.textContent = 'Copiato!';
    setTimeout(() => { copyBtn.textContent = 'Copia indirizzo'; }, 1500);
  };

  const gmailLink = document.createElement('a');
  gmailLink.className = 'btn outline';
  gmailLink.href = gmailHref;
  gmailLink.target = '_blank';
  gmailLink.rel = 'noopener';
  gmailLink.textContent = 'Apri con Gmail';

  const clientLink = document.createElement('a');
  clientLink.className = 'btn outline';
  clientLink.href = mailtoHref;
  clientLink.textContent = 'Apri il tuo client di posta';

  actions.append(copyBtn, gmailLink, clientLink);
  box.append(closeBtn, title, addr, actions);
  overlay.appendChild(box);

  const CLOSE_MS = 250; // stessa durata degli altri popup
  let isClosing = false;

  function onEsc(e) {
    if (e.key === 'Escape') closePopup();
  }

  function closePopup() {
    if (isClosing) return;
    isClosing = true;
    document.removeEventListener('keydown', onEsc);
    overlay.classList.remove('is-visible');
    setTimeout(() => overlay.remove(), CLOSE_MS);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });
  document.addEventListener('keydown', onEsc);

  document.body.appendChild(overlay);
  // Doppio rAF: il browser deve prima disegnare lo stato iniziale (opacità 0),
  // altrimenti la transizione non parte e il popup compare di scatto.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  });
}