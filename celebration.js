// The canvas lives inside the modal so the browser's dialog top layer cannot hide it.
export function celebrate(dialog){
  dialog.querySelector('.celebration-canvas')?.remove();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const canvas=document.createElement('canvas');canvas.className='celebration-canvas';canvas.setAttribute('aria-hidden','true');dialog.append(canvas);
  const width=dialog.clientWidth,height=dialog.clientHeight,ratio=Math.min(devicePixelRatio||1,2);canvas.width=width*ratio;canvas.height=height*ratio;
  const ctx=canvas.getContext('2d');if(!ctx){canvas.remove();return;}ctx.scale(ratio,ratio);
  const colors=['#ed3d65','#ffd34e','#258bdf','#42b884','#a86bdf'];
  const particles=Array.from({length:150},(_,i)=>({x:i%2?width:0,y:height*.58,vx:(i%2?-1:1)*(2+Math.random()*7),vy:-4-Math.random()*10,rotation:Math.random()*6,spin:(Math.random()-.5)*.3,color:colors[i%colors.length],size:5+Math.random()*6}));
  let frame,start,previous;
  const stop=()=>{cancelAnimationFrame(frame);canvas.remove();dialog.removeEventListener('close',stop);};dialog.addEventListener('close',stop,{once:true});
  const draw=time=>{
    start??=time;const step=Math.min(2,(time-(previous??time-16.7))/16.7);previous=time;
    ctx.clearRect(0,0,width,height);ctx.globalAlpha=Math.min(1,(3200-(time-start))/700);
    for(const p of particles){p.x+=p.vx*step;p.y+=p.vy*step;p.vy+=.19*step;p.rotation+=p.spin*step;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation);ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.55);ctx.restore();}
    if(time-start<3200&&dialog.open)frame=requestAnimationFrame(draw);else stop();
  };frame=requestAnimationFrame(draw);
}
