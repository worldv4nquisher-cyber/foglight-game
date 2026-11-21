import sys, json, os
import os as _os; REPO_ROOT=_os.environ.get('REPO_ROOT', _os.path.abspath(_os.path.join(_os.path.dirname(__file__), '../..')))
import numpy as np
from PIL import Image
Q=REPO_ROOT+'/docs/bugs/qa-v0.1-batch13/shots-029'; P=REPO_ROOT+'/docs/tasks/shots-029'
rows=[]
for f in sorted(os.listdir(Q)):
    if not f.endswith('-lm1.png') or not f.startswith(sys.argv[1]): continue
    v=f[:-8]
    L=lambda p: np.asarray(Image.open(p).convert('RGB'),dtype=np.float32)
    q0,q1=L(f'{Q}/{v}-lm0.png'),L(f'{Q}/{v}-lm1.png')
    r={'view':v,'lum_lm0':round(float(q0.mean()),1),'lum_lm1':round(float(q1.mean()),1),'d_lm1_lm0':round(float(np.abs(q1-q0).mean()),2),
       'black_lm1%':round(float(((q1.max(2))<3).mean()*100),2),'white_lm1%':round(float(((q1.min(2))>252).mean()*100),2)}
    if os.path.exists(f'{P}/{v}-lm1.png'):
        p0,p1=L(f'{P}/{v}-lm0.png'),L(f'{P}/{v}-lm1.png')
        if p1.shape==q1.shape:
            r['d_vsProg_lm1']=round(float(np.abs(q1-p1).mean()),2); r['d_vsProg_lm0']=round(float(np.abs(q0-p0).mean()),2)
            r['prog_d_lm1_lm0']=round(float(np.abs(p1-p0).mean()),2)
            r['p99_vsProg_lm1']=round(float(np.percentile(np.abs(q1-p1).max(2),99)),1)
    rows.append(r)
for r in rows: print(json.dumps(r,ensure_ascii=False))
