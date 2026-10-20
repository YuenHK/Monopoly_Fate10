#!/usr/bin/env python3
# Original CC0 ba-dum-tss reaction sting. No speech or sampled recordings.
import math,random,struct,subprocess,os
from pathlib import Path
rate=44100;length=1.6;frames=[0.0]*int(rate*length);rng=random.Random(42)
for start,kind,duration in [(0.0,'snare',.16),(.22,'tom',.18),(.46,'cymbal',.85)]:
 for n in range(int(rate*duration)):
  t=n/rate;noise=rng.uniform(-1,1)
  if kind=='snare':v=(noise*.5+math.sin(2*math.pi*180*t)*.25)*math.exp(-t*25)
  elif kind=='tom':v=math.sin(2*math.pi*(110*t+2*(1-math.exp(-20*t))))*math.exp(-t*19)*.7
  else:v=(noise*.55+math.sin(2*math.pi*7100*t)*.08)*math.exp(-t*6)*min(1,t*200)
  frames[int(start*rate)+n]+=v*.3
out=Path(__file__).resolve().parent.parent/'theme-media/school-sounds/meme-ba-dum-tss.mp3'
subprocess.run([os.environ.get('FFMPEG_BIN','ffmpeg'),'-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(rate),'-ac','1','-i','pipe:0','-codec:a','libmp3lame','-b:a','96k',str(out)],input=struct.pack('<%df'%len(frames),*frames),check=True)
