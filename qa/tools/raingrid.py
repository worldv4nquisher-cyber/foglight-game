import sys
from PIL import Image, ImageChops
sc=sys.argv[1]; names=sys.argv[2].split(','); outp=sys.argv[3]
rows=[]
for n in names:
    a=Image.open(f'{sc}-{n}-rain.png').convert('RGB'); b=Image.open(f'{sc}-{n}-norain.png').convert('RGB')
    d=ImageChops.difference(a,b).convert('L')
    m=d.point(lambda v:255 if v>6 else 0)
    cnt=sum(1 for v in m.getdata() if v)
    print(n,'diffpx>6:',cnt, 'bbox',m.getbbox())
    w,h=480,270
    row=Image.new('RGB',(w*3,h)); row.paste(a.resize((w,h)),(0,0)); row.paste(b.resize((w,h)),(w,0)); row.paste(d.point(lambda v:min(255,v*12)).convert('RGB').resize((w,h)),(2*w,0)); rows.append(row)
g=Image.new('RGB',(1440,270*len(rows)))
for i,r in enumerate(rows): g.paste(r,(0,i*270))
g.save(outp,quality=85)
