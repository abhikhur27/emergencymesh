#!/usr/bin/env bash
set -euo pipefail
python3 - "$HOME/.brev/credentials.json" <<'PY'
import json,sys,base64,datetime
try:
    with open(sys.argv[1],encoding='utf-8') as source: data=json.load(source)
except FileNotFoundError:
    print(json.dumps({'credentialFilePresent':False,'refreshableNormalLogin':False}));sys.exit(2)
def fields(value):
    if isinstance(value,dict):
        for key,item in value.items():
            yield str(key).replace('_','').lower(),item
            yield from fields(item)
    elif isinstance(value,list):
        for item in value: yield from fields(item)
values=dict(fields(data));refresh=values.get('refreshtoken','');access=values.get('accesstoken','')
refreshable=isinstance(refresh,str) and len(refresh.split(':'))==2 and all(refresh.split(':')) and refresh!='auto-login'
api_key=values.get('apikey','');has_api_key=isinstance(api_key,str) and api_key.startswith('bak-')
expires=None
try:
    payload=access.split('.')[1];claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
    if isinstance(claims.get('exp'),(int,float)): expires=datetime.datetime.fromtimestamp(claims['exp'],datetime.timezone.utc).isoformat()
except Exception: pass
print(json.dumps({'credentialFilePresent':True,'refreshableNormalLogin':refreshable,'accessExpiresAt':expires,'apiKeyPresent':has_api_key,'apiKeyOrganizationId':values.get('apikeyorgid') if has_api_key else None,'tokenValuesIncluded':False}))
sys.exit(0 if refreshable or has_api_key else 2)
PY
