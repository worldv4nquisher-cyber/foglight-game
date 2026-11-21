import sys,re
import os as _os; REPO_ROOT=_os.environ.get('REPO_ROOT', _os.path.abspath(_os.path.join(_os.path.dirname(__file__), '../..')))
p=REPO_ROOT+'/docs/bugs/qa-v0.1-batch27.md'; n,res,note=sys.argv[1],sys.argv[2],sys.argv[3]
L=open(p).read().split('\n')
for i,l in enumerate(L):
    if l.startswith(f'| {n} | '):
        c=l.split(' | '); L[i]=f'| {n} | {c[1]} | {res} | {note} |'; break
else: sys.exit('row not found')
open(p,'w').write('\n'.join(L))
