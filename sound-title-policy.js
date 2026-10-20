// Title screening only: this does not certify the spoken audio content.
export function soundTitleReason(name){
 if(typeof name!=='string'||!name.trim())return '名稱不明';
 const n=name.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{Cf}_]+/gu,'');
 const simplified={'妈':'媽','鸡':'雞','机':'機','贱':'賤','阴':'陰','阳':'陽','茎':'莖','枪':'槍','弹':'彈','杀':'殺','梦':'夢','遗':'遺','恶':'惡','兽':'獸','头':'頭','发':'發','扩':'擴','罗':'羅','语':'語','脏':'髒'};
 const title=[...n].map(c=>simplified[c]||c).join('');
 const groups=[
 ['粗口／侮辱',/幹|干你|乾你|操你|他媽|她媽|你媽|你娘|老母|機掰|雞掰|雞雞|雞巴|雞八|雞吧|屌|撚|柒|閪|仆街|扑街|冚家|靠北|靠杯|靠腰|三小|殺小|蝦小|洨|懶叫|懶覺|懶趴|賤|贱|婊|傻逼|傻b|牛逼|艘逼|西八|阿西|八嘎|髒話|脏话|臭甲|智障|白痴|低能|支那|黑鬼|吔屎|吃屎|呷屎/],
 ['不雅／成人',/色情|性愛|做愛|做爱|性交|強姦|强奸|姦|奸淫|陰莖|阴茎|陰道|阴道|陽具|奶頭|乳頭|乳房|胸部|巨乳|大奶|打手槍|打飞机|自慰|高潮|射了|我要射|夢遺|梦遗|呻吟|喘氣|喘息|舔|屁股|賣身|卖身|坐檯|查某間|裸|光屁|脫褲|脱裤|扒下|掰開|擴張|扩张|發育|登dua|傑哥|杰哥|阿偉|成都超人|羅莉|蘿莉|萝莉|野獸|惡臭|獸先輩|先輩|吹喇叭|放屁|尿尿|大便|泡尿/],
 ['暴力／驚嚇／爆音',/自殺|自杀|結束自己|殺死|殺人|杀死|杀人|去死|死啦垃圾|爆頭|爆头|中.*槍|一槍|開槍|开枪|掃射|扫射|槍聲|枪声|子彈|核彈|核弹|恐怖|驚悚|陰森|暴音|爆音|破音|暴斃|希特勒|納粹|阿拉花瓜|打爛|電死|溺水/]
 ];
 for(const [reason,re] of groups)if(re.test(title))return reason;
 if(/fuck|fuk|fck|f\*ck|motherf|bitch|porn|hentai|horny|orgasm|cumshot|nigg|blowjob|handjob|asshole|bullshit|holyshit|shit|stfu|nsfw/.test(n)||/(?:^|[^a-z])(shit|sex|sexy|dick|cock|cunt|slut|wtf|stfu|nsfw)(?:$|[^a-z])/i.test(name.normalize('NFKC')))return '外語粗口／成人';
 return null;
}
export function validMemeSound(s){
 if(!s||!/^\d{1,12}$/.test(s.id)||typeof s.name!=='string'||s.name.length>250||soundTitleReason(s.name))return false;
 try{const u=new URL(s.url);return u.protocol==='https:'&&u.hostname==='memeprod.sgp1.digitaloceanspaces.com'&&!u.port&&!u.username&&!u.password&&/^\/user-sound\/[\w.-]+\.(mp3|wav|ogg|m4a)$/i.test(u.pathname)&&!u.search&&!u.hash;}catch{return false;}
}
