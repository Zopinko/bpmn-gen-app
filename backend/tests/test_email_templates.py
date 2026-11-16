import pytest

from auth import email_templates


@pytest.fixture(autouse=True)
def app_url(monkeypatch):
    monkeypatch.setenv("PASSWORD_RESET_URL_BASE", "https://app.example.test/reset-password")


def all_emails(language):
    return [
        email_templates.email_verification("a@example.test", "https://app.example.test/verify-email?token=v", language),
        email_templates.password_reset("a@example.test", "https://app.example.test/reset-password?token=r", language, 30),
        email_templates.password_changed("a@example.test", language),
        email_templates.organization_invite(
            "a@example.test", "https://app.example.test/join-org?token=i", "Team", "owner@example.test", language, 7
        ),
        *[email_templates.org_access_notice("Team", kind, language) for kind in ("added", "promoted", "removed")],
    ]


@pytest.mark.parametrize("language", ["sk", "en"])
def test_every_email_has_subject_text_and_html(language):
    for message in all_emails(language):
        assert message.subject
        assert message.html.startswith("<!DOCTYPE html>")
        assert f'<html lang="{language}">' in message.html
        assert "<" not in message.text  # plain text carries no markup
        # every link in the text part is on its own line (tests and some clients rely on it)
        for line in message.text.splitlines():
            if "https://app.example.test" in line:
                assert line.startswith("https://")


def test_links_appear_in_both_parts():
    message = email_templates.password_reset("a@example.test", "https://app.example.test/reset-password?token=r&x=1", "en", 30)
    assert "https://app.example.test/reset-password?token=r&x=1" in message.text.splitlines()
    assert 'href="https://app.example.test/reset-password?token=r&amp;x=1"' in message.html
    assert "30 minutes" in message.text


def test_user_supplied_names_are_escaped():
    message = email_templates.organization_invite(
        "a@example.test", "https://app.example.test/join-org?token=i", "<b>Evil</b> & Co", "<script>x</script>", "en", 7
    )
    assert "<script>" not in message.html
    assert "<b>Evil</b>" not in message.html
    assert "&lt;b&gt;Evil&lt;/b&gt; &amp; Co" in message.html
    assert "<b>Evil</b> & Co" in message.text


def test_password_changed_links_to_forgot_password():
    message = email_templates.password_changed("a@example.test", "sk")
    assert "https://app.example.test/forgot-password" in message.text


def test_unknown_org_notice_is_rejected():
    with pytest.raises(ValueError):
        email_templates.org_access_notice("Team", "nope", "en")
