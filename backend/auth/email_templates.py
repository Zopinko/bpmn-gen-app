"""Transactional emails: subject, plain-text body and HTML body for every email the app sends.

The HTML follows the app's look (indigo accent, brand mark, Inter/system fonts) but is built
the email-client way: nested tables, inline styles, no images and no web fonts, so it renders
the same in Gmail, Outlook and Apple Mail. The plain-text part carries the same content and
keeps every link on its own line.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from html import escape, unescape
from urllib.parse import urlsplit, urlunsplit

from core.auth_config import get_auth_config

# App colours (frontend/src/theme.css), adjusted for a light email.
ACCENT = "#5e60ea"
ACCENT_SOFT = "#8183ff"
TEXT = "#18181b"
TEXT_2 = "#3f3f46"
TEXT_3 = "#71717a"
LINE = "#e4e4e7"
PAGE_BG = "#f4f4f5"
CARD_BG = "#ffffff"
NOTE_BG = "#f6f6fe"
WARN_BG = "#fff8eb"
WARN_LINE = "#f5d9a8"
FONT = "Inter, 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif"


@dataclass(frozen=True)
class Email:
    subject: str
    text: str
    html: str


def app_link(route: str = "") -> str:
    """Absolute URL of a page in the app, derived from PASSWORD_RESET_URL_BASE."""
    base = urlsplit(get_auth_config().password_reset_url_base)
    directory = base.path.rstrip("/").rpartition("/")[0]
    path = f"{directory}/{route}" if route else f"{directory}/"
    return urlunsplit((base.scheme, base.netloc, path, "", ""))


def _lang(language: str) -> str:
    return "sk" if language == "sk" else "en"


FOOTER = {
    "sk": (
        "Tento e-mail vám poslal BPMN.GEN v súvislosti s vaším účtom alebo pozvánkou. Neodpovedajte naň, "
        "ak potrebujete pomoc, napíšte nám cez bpmngen.com/sk/contact."
    ),
    "en": (
        "BPMN.GEN sent you this email about your account or an invitation. Please don't reply to it; "
        "if you need help, write to us at bpmngen.com/contact."
    ),
}
CONTACT_URL = {"sk": "https://bpmngen.com/sk/contact", "en": "https://bpmngen.com/contact"}
BUTTON_FALLBACK = {
    "sk": "Ak tlačidlo nefunguje, skopírujte tento odkaz do prehliadača:",
    "en": "If the button doesn't work, copy this link into your browser:",
}


def _brand_html() -> str:
    # The app's brand mark: an indigo square with an inset, drawn with table cells.
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="padding:0 10px 0 0;vertical-align:middle;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="20" height="20"
      style="width:20px;height:20px;background:{ACCENT_SOFT};border-radius:5px;"><tr>
      <td align="center" valign="middle" style="width:20px;height:20px;padding:0;line-height:0;font-size:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="8" height="8" align="center"
          style="width:8px;height:8px;background:#ffffff;border-radius:2px;"><tr>
          <td style="width:8px;height:8px;line-height:0;font-size:0;">&nbsp;</td></tr></table>
      </td></tr></table>
  </td>
  <td style="vertical-align:middle;font-family:{FONT};font-size:16px;font-weight:700;letter-spacing:-0.02em;color:{TEXT};">BPMN.Gen</td>
</tr></table>"""


def _button_html(label: str, url: str) -> str:
    safe_url = escape(url, quote=True)
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;"><tr>
  <td bgcolor="{ACCENT}" style="border-radius:8px;background:{ACCENT};">
    <a href="{safe_url}" target="_blank"
      style="display:inline-block;padding:13px 22px;font-family:{FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">{escape(label)}</a>
  </td></tr></table>"""


def _note_html(text: str, tone: str = "info") -> str:
    background, border = (WARN_BG, WARN_LINE) if tone == "warn" else (NOTE_BG, "#e3e3fb")
    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr>
  <td style="padding:14px 16px;background:{background};border:1px solid {border};border-radius:8px;font-family:{FONT};font-size:14px;line-height:21px;color:{TEXT_2};">{text}</td>
</tr></table>"""


def _layout(
    *,
    language: str,
    preheader: str,
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None = None,
    note: str | None = None,
    note_tone: str = "info",
    note_first: bool = False,
) -> str:
    """Full HTML document. `heading` and `paragraphs` may contain trusted markup; escape user input first."""
    lang = _lang(language)
    body = "".join(
        f'<p style="margin:0 0 14px;font-family:{FONT};font-size:15px;line-height:24px;color:{TEXT_2};">{p}</p>'
        for p in paragraphs
    )
    button_block = ""
    fallback_block = ""
    if button:
        label, url = button
        button_block = _button_html(label, url)
        safe_url = escape(url, quote=True)
        fallback_block = f"""
<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid {LINE};font-family:{FONT};font-size:12.5px;line-height:19px;color:{TEXT_3};">
  {BUTTON_FALLBACK[lang]}<br>
  <a href="{safe_url}" style="color:{ACCENT};word-break:break-all;">{escape(url)}</a>
</p>"""
    note_block = _note_html(note, note_tone) if note else ""
    contact = CONTACT_URL[lang]

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{escape(heading_text(heading))}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE_BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:{PAGE_BG};">{escape(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAGE_BG};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 18px;">{_brand_html()}</td></tr>
    <tr><td style="background:{CARD_BG};border:1px solid {LINE};border-radius:12px;padding:36px 32px 30px;">
      <div style="height:3px;width:40px;background:{ACCENT_SOFT};border-radius:3px;margin:0 0 22px;line-height:3px;font-size:0;">&nbsp;</div>
      <h1 style="margin:0 0 16px;font-family:{FONT};font-size:22px;line-height:29px;font-weight:700;letter-spacing:-0.02em;color:{TEXT};">{heading}</h1>
      {body}
      {note_block if note_first else ""}
      {button_block}
      {"" if note_first else note_block}
      {fallback_block}
    </td></tr>
    <tr><td style="padding:20px 8px 0;font-family:{FONT};font-size:12px;line-height:18px;color:{TEXT_3};">
      {escape(FOOTER[lang]).replace(escape(contact.removeprefix("https://")), f'<a href="{contact}" style="color:{TEXT_3};">{escape(contact.removeprefix("https://"))}</a>')}
      <br><br>BPMN.GEN &middot; <a href="https://bpmngen.com" style="color:{TEXT_3};">bpmngen.com</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


def heading_text(heading: str) -> str:
    """Heading without markup, for <title> and the plain-text part."""
    return unescape(re.sub(r"<[^>]+>", "", heading))


def _text(heading: str, paragraphs: list[str], link: tuple[str, str] | None, note: str | None, language: str) -> str:
    parts = [heading_text(heading), ""]
    parts += [heading_text(p) for p in paragraphs]
    if link:
        label, url = link
        parts += ["", f"{label}:", url]
    if note:
        parts += ["", heading_text(note)]
    parts += ["", "--", FOOTER[_lang(language)]]
    return "\n".join(parts)


def _build(
    *,
    subject: str,
    language: str,
    preheader: str,
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None = None,
    note: str | None = None,
    note_tone: str = "info",
    note_first: bool = False,
) -> Email:
    return Email(
        subject=subject,
        text=_text(heading, paragraphs, button, note, language),
        html=_layout(
            language=language,
            preheader=preheader,
            heading=heading,
            paragraphs=paragraphs,
            button=button,
            note=note,
            note_tone=note_tone,
            note_first=note_first,
        ),
    )


def _strong(value: str) -> str:
    return f'<strong style="color:{TEXT};font-weight:600;">{escape(value)}</strong>'


# --- the emails -----------------------------------------------------------------------------


def email_verification(email: str, link: str, language: str) -> Email:
    if _lang(language) == "sk":
        return _build(
            subject="Overte svoj e-mail pre BPMN.GEN",
            language="sk",
            preheader="Jedno kliknutie a môžete začať mapovať procesy.",
            heading="Overte svoju e-mailovú adresu",
            paragraphs=[
                "Vitajte v BPMN.GEN! Ešte potvrďte, že adresa " + _strong(email) + " patrí vám, a môžete začať.",
            ],
            button=("Overiť e-mail", link),
            note="Odkaz platí 24 hodín. Ak ste účet v BPMN.GEN nezakladali vy, tento e-mail pokojne ignorujte.",
        )
    return _build(
        subject="Verify your email for BPMN.GEN",
        language="en",
        preheader="One click and you can start mapping processes.",
        heading="Verify your email address",
        paragraphs=[
            "Welcome to BPMN.GEN! Please confirm that " + _strong(email) + " belongs to you, and you're ready to go.",
        ],
        button=("Verify email", link),
        note="This link is valid for 24 hours. If you didn't create a BPMN.GEN account, you can safely ignore this email.",
    )


def password_reset(email: str, link: str, language: str, ttl_minutes: int) -> Email:
    if _lang(language) == "sk":
        return _build(
            subject="Obnova hesla k BPMN.GEN",
            language="sk",
            preheader="Nastavte si nové heslo k svojmu účtu.",
            heading="Nastavte si nové heslo",
            paragraphs=["Dostali sme žiadosť o obnovu hesla k účtu " + _strong(email) + "."],
            button=("Nastaviť nové heslo", link),
            note=(
                f"Odkaz platí {ttl_minutes} minút. Ak si vyžiadate nový, tento prestane platiť. "
                "Ak ste o obnovu nežiadali vy, e-mail ignorujte, heslo zostane bez zmeny."
            ),
        )
    return _build(
        subject="Reset your BPMN.GEN password",
        language="en",
        preheader="Choose a new password for your account.",
        heading="Choose a new password",
        paragraphs=["We received a request to reset the password for " + _strong(email) + "."],
        button=("Set a new password", link),
        note=(
            f"This link is valid for {ttl_minutes} minutes. Requesting a new one cancels it. "
            "If you didn't ask for this, ignore this email and your password stays the same."
        ),
    )


def password_changed(email: str, language: str) -> Email:
    forgot = app_link("forgot-password")
    if _lang(language) == "sk":
        return _build(
            subject="Heslo k vášmu účtu BPMN.GEN sa zmenilo",
            language="sk",
            preheader="Ak išlo o vašu zmenu, nemusíte nič robiť.",
            heading="Heslo bolo zmenené",
            paragraphs=[
                "Heslo k účtu " + _strong(email) + " bolo práve úspešne zmenené.",
                "Ak išlo o vašu zmenu, nemusíte nič robiť.",
            ],
            button=("Obnoviť heslo", forgot),
            note="<strong>Nejde o vašu zmenu?</strong> Hneď si heslo obnovte tlačidlom nižšie a napíšte nám cez kontaktný formulár.",
            note_tone="warn",
            note_first=True,
        )
    return _build(
        subject="Your BPMN.GEN password changed",
        language="en",
        preheader="If this was you, there's nothing else to do.",
        heading="Your password was changed",
        paragraphs=[
            "The password for " + _strong(email) + " was just changed successfully.",
            "If this was you, there's nothing else to do.",
        ],
        button=("Reset password", forgot),
        note="<strong>Didn't change it?</strong> Reset your password right away with the button below and let us know through the contact form.",
        note_tone="warn",
        note_first=True,
    )


def organization_invite(email: str, link: str, org_name: str, inviter: str, language: str, ttl_days: int) -> Email:
    if _lang(language) == "sk":
        return _build(
            subject="Pozvánka do organizácie v BPMN.GEN",
            language="sk",
            preheader=f"{inviter} vás pozýva do organizácie {org_name}.",
            heading="Pozvánka do organizácie " + escape(org_name),
            paragraphs=[
                _strong(inviter) + " vás pozýva do organizácie " + _strong(org_name)
                + " v BPMN.GEN, kde tím spoločne mapuje a spravuje svoje procesy.",
            ],
            button=("Prijať pozvánku", link),
            note=(
                "Prihláste sa účtom s overenou adresou " + _strong(email)
                + ". Ak účet ešte nemáte, vytvorte si ho na tejto adrese. "
                + f"Pozvánka platí {ttl_days} dní."
            ),
        )
    return _build(
        subject="You're invited to an organization in BPMN.GEN",
        language="en",
        preheader=f"{inviter} invited you to join {org_name}.",
        heading="Join " + escape(org_name) + " on BPMN.GEN",
        paragraphs=[
            _strong(inviter) + " invited you to join " + _strong(org_name)
            + " in BPMN.GEN, where the team maps and maintains its processes together.",
        ],
        button=("Accept invitation", link),
        note=(
            "Sign in with the verified address " + _strong(email)
            + ". If you don't have an account yet, create one with this address. "
            + f"The invitation is valid for {ttl_days} days."
        ),
    )


def org_access_notice(org_name: str, notice_type: str, language: str) -> Email:
    lang = _lang(language)
    org = _strong(org_name)
    open_app = ("Otvoriť BPMN.GEN" if lang == "sk" else "Open BPMN.GEN", app_link())
    texts = {
        "sk": {
            "added": dict(
                subject="Pridali vás do organizácie v BPMN.GEN",
                preheader=f"Máte prístup do organizácie {org_name}.",
                heading="Ste v tíme " + escape(org_name),
                paragraphs=[
                    "Odteraz máte prístup do organizácie " + org + " v BPMN.GEN.",
                    "Jej procesy, poznámky a tím nájdete po prihlásení, keď si ju zvolíte ako aktívnu organizáciu.",
                ],
                button=open_app,
            ),
            "promoted": dict(
                subject="Pridelili vám rolu vlastníka v BPMN.GEN",
                preheader=f"Teraz môžete spravovať organizáciu {org_name}.",
                heading="Ste vlastníkom organizácie " + escape(org_name),
                paragraphs=[
                    "V organizácii " + org + " vám pridelili rolu vlastníka.",
                    "Môžete spravovať členov, ich role a pozvánky.",
                ],
                button=open_app,
            ),
            "removed": dict(
                subject="Váš prístup do organizácie v BPMN.GEN bol odobratý",
                preheader=f"Už nemáte prístup do organizácie {org_name}.",
                heading="Prístup do organizácie bol odobratý",
                paragraphs=[
                    "Prístup do organizácie " + org + " v BPMN.GEN vám bol odobratý.",
                    "Jej procesy, poznámky a aktivitu tímu už neuvidíte. Váš účet a vlastné procesy zostávajú.",
                ],
                note="Ak je to omyl, ozvite sa vlastníkovi organizácie.",
            ),
        },
        "en": {
            "added": dict(
                subject="You were added to a BPMN.GEN organization",
                preheader=f"You now have access to {org_name}.",
                heading="You're in " + escape(org_name),
                paragraphs=[
                    "You were granted access to " + org + " in BPMN.GEN.",
                    "Sign in and choose it as your active organization to see its processes, notes and team.",
                ],
                button=open_app,
            ),
            "promoted": dict(
                subject="You were made an owner of a BPMN.GEN organization",
                preheader=f"You can now manage {org_name}.",
                heading="You're now an owner of " + escape(org_name),
                paragraphs=[
                    "You were assigned the owner role in " + org + ".",
                    "You can now manage its members, their roles and invitations.",
                ],
                button=open_app,
            ),
            "removed": dict(
                subject="Your access to a BPMN.GEN organization was removed",
                preheader=f"You no longer have access to {org_name}.",
                heading="Your access was removed",
                paragraphs=[
                    "Your access to " + org + " in BPMN.GEN was removed.",
                    "You won't see its processes, notes or team activity anymore. Your account and your own processes stay.",
                ],
                note="If you think this is a mistake, contact the organization's owner.",
            ),
        },
    }
    spec = texts[lang].get(notice_type)
    if not spec:
        raise ValueError("Unknown organization access notice.")
    return _build(language=lang, **spec)
