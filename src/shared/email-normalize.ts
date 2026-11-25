/**
 * Normalización de correos y lista de dominios de correo temporal (F12).
 * Solo dominios claramente desechables; jamás proveedores legítimos.
 * Versión de la lista: sube `DISPOSABLE_DOMAINS_VERSION` al editarla.
 */
export const DISPOSABLE_DOMAINS_VERSION = 1;

const DISPOSABLE_LIST = `
mailinator.com mailinator.net mailinator.org mailinator2.com maildrop.cc
guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamailblock.com
sharklasers.com grr.la pokemail.net spam4.me
10minutemail.com 10minutemail.net 10minutemail.org 10minutemail.co.uk 10minemail.com 20minutemail.com 30minutemail.com
tempmail.com temp-mail.org temp-mail.io tempmail.net tempmail.dev tempmailo.com tempmail.plus temporary-mail.net tempinbox.com tempr.email
yopmail.com yopmail.net yopmail.fr cool.fr.nf jetable.fr.nf nospam.ze.tc nomail.xl.cx mega.zik.dj speed.1s.fr courriel.fr.nf moncourrier.fr.nf monemail.fr.nf monmail.fr.nf
throwawaymail.com throwaway.email trashmail.com trashmail.net trashmail.de trashmail.org trash-mail.com trash-mail.de
getnada.com nada.email nada.ltd
dispostable.com discard.email discardmail.com discardmail.de
fakeinbox.com fakemail.net fakemailgenerator.com
mailnesia.com mailcatch.com mailnull.com mailexpire.com mailmoat.com mailscrap.com
mintemail.com mohmal.com moakt.com moakt.cc moakt.ws
emailondeck.com email-fake.com emailfake.com emailtemporanea.net emailtemporar.ro
burnermail.io anonbox.net spambox.us spamgourmet.com spamex.com spamfree24.org spamhole.com
mytemp.email mytrashmail.com mailtemp.info tmpmail.net tmpmail.org tmails.net
harakirimail.com incognitomail.org incognitomail.com
inboxkitten.com inboxbear.com
33mail.com anonaddy.me
minuteinbox.com mail-temporaire.fr
luxusmail.org meltmail.com mt2015.com
owlymail.com receiveee.com
jourrapide.com armyspy.com cuvox.de dayrep.com einrot.com fleckens.hu gustr.com rhyta.com superrito.com teleworm.us
byom.de binkmail.com bobmail.info chammy.info devnullmail.com deadaddress.com
eyepaste.com filzmail.com garliclife.com gishpuppy.com great-host.in
hidemail.de ieatspam.eu ieatspam.info imails.info instant-mail.de
kasmail.com klzlk.com koszmail.pl kurzepost.de lifebyfood.com
lookugly.com lr78.com maileater.com mailforspam.com mailguard.me mailimate.com
mailin8r.com mailzilla.com nepwk.com nobulk.com noclickemail.com
objectmail.com oneoffemail.com onewaymail.com pjjkp.com
proxymail.eu putthisinyourspamdatabase.com quickinbox.com rcpt.at
safetymail.info selfdestructingmail.com sendspamhere.com shieldedmail.com
sogetthis.com spamavert.com spambog.com spamday.com spaml.com
tempemail.com tempemail.net tempomail.fr thankyou2010.com
trbvm.com wegwerfmail.de wegwerfmail.net wegwerfmail.org wh4f.org
yepmail.net zippymail.info 0-mail.com 0815.ru
`;

export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set(
  DISPOSABLE_LIST.split(/\s+/).filter(Boolean),
);

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Minúsculas, sin `+etiqueta` y, en Gmail, sin puntos. */
export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  let local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Dominio exacto o subdominio de uno de la lista. */
export function isDisposableEmail(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return false;
  let domain = email
    .trim()
    .toLowerCase()
    .slice(at + 1);
  while (domain) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
    const dot = domain.indexOf(".");
    if (dot < 0) return false;
    domain = domain.slice(dot + 1);
  }
  return false;
}

export const DISPOSABLE_EMAIL_MESSAGE =
  "Usa un correo personal: no aceptamos direcciones temporales o desechables.";
