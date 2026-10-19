export const THEMES = Object.freeze([
  {id:'basic',name:'基礎主題',icon:'🎲',colors:['#e8eee6','#cf3444','#ffdc74'],music:'sound/bgm.mp3',sound:null,video:'theme-media/meme.mp4',effect:'confetti',avatar:'🐱',description:'原有配色 · MEME 音樂 · 經典彩炮 · 迷因循環影片'},
  {id:'cat',name:'貓主題',icon:'🐱',colors:['#fff0df','#bd6948','#e8aa91'],music:'theme-media/cat-music.mp3',sound:'theme-media/meow.mp3',video:'theme-media/cat.mp4',effect:'cats',avatar:'🐱',description:'奶油橘配色 · 喵聲節奏音樂 · 貓咪噴發 · 貓咪循環影片'},
  {id:'dog',name:'狗主題',icon:'🐶',colors:['#f1e4cf','#956037','#8cbfc1'],music:'theme-media/dog-music.mp3',sound:'theme-media/bark.mp3',video:'theme-media/dog.mp4',effect:'dogs',avatar:'🐶',description:'暖棕配色 · 汪聲節奏音樂 · 狗狗噴發 · 狗狗循環影片'}
]);
export function themeById(id){return THEMES.find(theme=>theme.id===id)||THEMES[0];}
export const THEME_MEDIA = ['meme.mp4','cat.mp4','dog.mp4','cat-music.mp3','dog-music.mp3','meow.mp3','bark.mp3','credits.html'];
