"""Register (or update) the PayPal sandbox webhook that feeds the ledger. Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
from .dev.vars; prints the webhook id to store as the PAYPAL_WEBHOOK_ID Worker secret.
Usage: python scripts/register-webhook.py https://<your-worker>/api/webhook"""
import base64, json, re, sys, urllib.request

EVENTS = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "INVOICING.INVOICE.PAID",
          "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]
B = "https://api-m.sandbox.paypal.com"
v = {m.group(1): m.group(2).strip() for line in open(".dev.vars", encoding="utf-8-sig") if (m := re.match(r"\s*([A-Z_]+)\s*=\s*\"?([^\"#\r\n]*)\"?\s*$", line))}
auth = base64.b64encode(f"{v['PAYPAL_CLIENT_ID']}:{v['PAYPAL_CLIENT_SECRET']}".encode()).decode()
tok = json.load(urllib.request.urlopen(urllib.request.Request(B + "/v1/oauth2/token", data=b"grant_type=client_credentials", headers={"Authorization": "Basic " + auth})))["access_token"]
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}
url = sys.argv[1]
hooks = json.load(urllib.request.urlopen(urllib.request.Request(B + "/v1/notifications/webhooks", headers=H)))["webhooks"]
hook = next((h for h in hooks if h["url"] == url), None)
if hook:
    body = [{"op": "replace", "path": "/event_types", "value": [{"name": n} for n in EVENTS]}]
    req = urllib.request.Request(f"{B}/v1/notifications/webhooks/{hook['id']}", data=json.dumps(body).encode(), method="PATCH", headers=H)
else:
    req = urllib.request.Request(B + "/v1/notifications/webhooks", data=json.dumps({"url": url, "event_types": [{"name": n} for n in EVENTS]}).encode(), headers=H)
print(json.load(urllib.request.urlopen(req))["id"])
