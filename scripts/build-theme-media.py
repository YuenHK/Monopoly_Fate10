# coding: utf-8
"""Build the bundled loops. Requires numpy, Pillow and imageio-ffmpeg (or FFMPEG_BIN).
Sources go in .archive/theme-sources; see theme-media/credits.html for attribution.
This script runs during asset preparation only, not on the application server.
"""
import os, math, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
try:
    import imageio_ffmpeg
    ffmpeg=os.environ.get('FFMPEG_BIN') or imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    ffmpeg=os.environ.get('FFMPEG_BIN','ffmpeg')
root=Path(__file__).resolve().parent.parent
sources=root/'.archive/theme-sources'
out=root/'theme-media';out.mkdir(exist_ok=True)
def ff(*args,**kwargs):
    return subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y',*map(str,args)],check=True,**kwargs)
for animal,seconds in [('cat',14),('dog',20)]:
    ff('-i',sources/(animal+'.webm'),'-t',seconds,'-an','-vf','scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2','-r','24','-c:v','libx264','-preset','fast','-crf','26','-pix_fmt','yuv420p','-movflags','+faststart',out/(animal+'.mp4'))
rate=44100
for animal,name in [('cat','meow'),('dog','bark')]:
    decoded=ff('-i',sources/(name+'.ogg'),'-f','f32le','-ac','1','-ar',rate,'pipe:1',capture_output=True).stdout
    sample=np.frombuffer(decoded,dtype='<f4').copy()
    sample/=max(.001,float(np.max(np.abs(sample))))
    active=np.flatnonzero(np.abs(sample)>.12)
    if len(active):sample=sample[max(0,int(active[0])-882):]
    sample=sample[:int(rate*(.76 if animal=='cat' else .52))]
    sample[-min(1323,len(sample)):]*=np.linspace(1,0,min(1323,len(sample)))
    beat=60/112;duration=32*beat
    track=np.zeros(int(duration*rate),dtype=np.float32)
    notes=[0,4,7,12,7,4,2,5,9,12,9,5,0,7,4,2,0,4,7,12,14,12,7,4,5,9,7,4,2,7,4,0]
    rng=np.random.default_rng(41)
    def add(wave,start,gain):
        start=int(start*rate);length=min(len(wave),len(track)-start)
        if length>0:track[start:start+length]+=wave[:length]*gain
    for i,note in enumerate(notes):
        pitch=2**((note+(0 if animal=='cat' else -2))/12)
        positions=np.arange(0,len(sample)-1,pitch)
        voice=np.interp(positions,np.arange(len(sample)),sample)
        if i%8!=7:add(voice,i*beat,.6)
        t=np.arange(int(rate*.24))/rate
        bass=130.81*2**(([0,0,5,7][(i//8)%4])/12)
        add(np.sin(2*np.pi*bass*t)*np.exp(-12*t),i*beat,.1)
        if i%2==0:add(np.sin(2*np.pi*(75*t+2*(1-np.exp(-30*t))))*np.exp(-22*t),i*beat,.18)
        hat=rng.uniform(-1,1,int(rate*.045))*np.exp(-np.arange(int(rate*.045))/500)
        add(hat,(i+.5)*beat,.035)
    track=np.tanh(track*1.2)
    track*=.77/max(.001,float(np.max(np.abs(track))))
    ff('-f','f32le','-ar',rate,'-ac','1','-i','pipe:0','-codec:a','libmp3lame','-b:a','128k',out/(animal+'-music.mp3'),input=track.astype('<f4').tobytes())
    ff('-i',sources/(name+'.ogg'),'-af','loudnorm=I=-19:TP=-2:LRA=7','-codec:a','libmp3lame','-b:a','128k',out/(name+'.mp3'))
# Original nine-second reaction-meme loop, drawn from geometric shapes.
font_path='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
if not Path(font_path).exists():font_path=os.environ['CJK_FONT']
large=ImageFont.truetype(font_path,64);small=ImageFont.truetype(font_path,28)
width,height,fps=854,480,24
process=subprocess.Popen([ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'meme.mp4')],stdin=subprocess.PIPE)
for frame in range(fps*9):
    scene=frame//(fps*3);phase=frame/fps
    image=Image.new('RGB',(width,height),['#e8eee6','#f8d8d9','#fff0c6'][scene]);draw=ImageDraw.Draw(image)
    cx=width//2+int(math.sin(phase*9)*(5 if scene!=2 else 15));cy=255+int(math.sin(phase*5)*5)
    if scene==1:
        for i in range(16):
            a=i*math.pi/8+phase*.1
            draw.line((cx+math.cos(a)*140,cy+math.sin(a)*140,cx+math.cos(a)*350,cy+math.sin(a)*350),fill='#df9894',width=7)
    draw.ellipse((cx-120,cy-120,cx+120,cy+120),fill='#ffdc74',outline='#263f37',width=7)
    if scene==0:
        draw.arc((cx-70,cy-45,cx-15,cy-8),180,355,fill='#263f37',width=7)
        draw.arc((cx+15,cy-45,cx+70,cy-8),180,355,fill='#263f37',width=7)
        draw.arc((cx-37,cy+40,cx+37,cy+75),190,350,fill='#263f37',width=7)
        draw.ellipse((cx+90,cy-60,cx+115,cy-10),fill='#74bdce')
    elif scene==1:
        draw.ellipse((cx-70,cy-60,cx-20,cy),fill='white',outline='#263f37',width=4)
        draw.ellipse((cx+20,cy-60,cx+70,cy),fill='white',outline='#263f37',width=4)
        draw.ellipse((cx-53,cy-42,cx-38,cy-13),fill='#263f37');draw.ellipse((cx+38,cy-42,cx+53,cy-13),fill='#263f37')
        draw.ellipse((cx-30,cy+30,cx+30,cy+90),fill='#873e3e',outline='#263f37',width=4)
    else:
        draw.rounded_rectangle((cx-90,cy-45,cx-7,cy+12),radius=14,fill='#263f37');draw.rounded_rectangle((cx+7,cy-45,cx+90,cy+12),radius=14,fill='#263f37');draw.line((cx-10,cy-30,cx+10,cy-30),fill='#263f37',width=8)
        draw.arc((cx-60,cy+10,cx+60,cy+85),5,175,fill='#263f37',width=9)
        for i in range(18):
            x=int((i*113+phase*42)%width);y=int((i*71+phase*95)%height)
            draw.rectangle((x,y,x+9,y+17),fill=['#cf3444','#126582','#48a577'][i%3])
    title=['唔好抽我…','命運：就係你！','我準備好啦！'][scene]
    draw.text((width//2,38),title,font=large,anchor='mt',fill='white',stroke_width=5,stroke_fill='#263f37')
    draw.text((width//2,420),'MONOPOLY · 全班都有機會',font=small,anchor='mt',fill='#263f37')
    process.stdin.write(image.tobytes())
process.stdin.close()
if process.wait():raise RuntimeError('Meme video encoding failed')
for path in sorted(out.iterdir()):print(path.name,path.stat().st_size)
