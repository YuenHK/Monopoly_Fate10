# Original CC0 classroom reaction animation. Requires Pillow; set FFMPEG_BIN as needed.
import os,math,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ffmpeg=os.environ.get('FFMPEG_BIN','ffmpeg')
out=Path(__file__).resolve().parent.parent/'theme-media/approved'
# Original nine-second reaction-meme loop, drawn from geometric shapes.
font_path='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
if not Path(font_path).exists():font_path=os.environ['CJK_FONT']
large=ImageFont.truetype(font_path,64);small=ImageFont.truetype(font_path,28)
width,height,fps=854,480,24
process=subprocess.Popen([ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'basic-brain.mp4')],stdin=subprocess.PIPE)
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
    title=['老師：呢題好簡單','我個腦：載入中…','原來我識答！'][scene]
    draw.text((width//2,38),title,font=large,anchor='mt',fill='white',stroke_width=5,stroke_fill='#263f37')
    draw.text((width//2,420),'MONOPOLY · 全班都有機會',font=small,anchor='mt',fill='#263f37')
    process.stdin.write(image.tobytes())
process.stdin.close()
if process.wait():raise RuntimeError('Meme video encoding failed')
