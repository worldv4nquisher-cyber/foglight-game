import sys, os
import os as _os; REPO_ROOT=_os.environ.get('REPO_ROOT', _os.path.abspath(_os.path.join(_os.path.dirname(__file__), '../..')))
from PIL import Image
Q=REPO_ROOT+'/docs/bugs/qa-v0.1-batch13/shots-029'; P=REPO_ROOT+'/docs/tasks/shots-029'; O=REPO_ROOT+'/docs/bugs/qa-v0.1-batch13/cmp'
for f in sorted(os.listdir(Q)):
    if not f.endswith('-lm1.png') or not f.startswith(sys.argv[1]): continue
    v=f[:-8]; ims=[Image.open(p).convert('RGB') for p in (f'{Q}/{v}-lm0.png',f'{Q}/{v}-lm1.png',f'{P}/{v}-lm0.png',f'{P}/{v}-lm1.png')]
    w,h=ims[0].size; g=Image.new('RGB',(w*2,h*2))
    for i,im in enumerate(ims): g.paste(im.resize((w,h)),((i%2)*w,(i//2)*h))
    g=g.resize((w,h)); g.save(f'{O}/{v}.jpg',quality=85); print(v)
