'use strict';
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const HOP_MS = 40;
const FFT_SIZE = 2048;
const PREVIEW_SECS = 6;
const PAST_SECS = 4;
const MIN_FREQ = 65;
const MAX_FREQ = 1050;
const RMS_THRESHOLD = 0.015;
const MAX_MIDI = 96;
const MIN_MIDI = 40;
function freqToMidi(f){return f<=0?0:12*Math.log2(f/440)+69;}
function midiToFreq(m){return 440*Math.pow(2,(m-69)/12);}'use strict';
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const HOP_MS = 40;
const FFT_SIZE = 2048;
const PREVIEW_SECS = 6;
const PAST_SECS = 4;
const MIN_FREQ = 65;
const MAX_FREQ = 1050;
const RMS_THRESHOLD = 0.015;
const MAX_MIDI = 96;
const MIN_MIDI = 40;
function freqToMidi(f){return f<=0?0:12*Math.log2(f/440)+69;}
function midiToFreq(m){return 440*Math.pow(2,(m-69)/12);}
function noteName(midi){const n=Math.round(midi);return NOTE_NAMES[n%12]+Math.floor(n/12-1);}
function clamp(v,m,M){return Math.max(m,Math.min(M,v));}

class PitchDetector{
    detect(buffer,sampleRate){
        const size=buffer.length, maxOffset=Math.floor(size/2);
        let rms=0; for(let i=0;i<size;i++) rms+=buffer[i]*buffer[i];
        rms=Math.sqrt(rms/size); if(rms<RMS_THRESHOLD) return null;
        const corr=new Float64Array(maxOffset);
        for(let o=0;o<maxOffset;o++){let s=0;for(let i=0;i<maxOffset;i++) s+=buffer[i]*buffer[i+o];corr[o]=s;}
        const n0=corr[0]||1; let fz=-1;
        for(let o=1;o<maxOffset;o++){if(corr[o-1]/n0>=0&&corr[o]/n0<0){fz=o;break;}}
        if(fz<2) return null; let bo=fz, mc=0;
        for(let o=fz;o<maxOffset;o++){if(corr[o]>mc){mc=corr[o];bo=o;}}
        if(mc/n0<0.15) return null;
        if(bo>1&&bo<maxOffset-2){const a=corr[bo-1],b=corr[bo],c=corr[bo+1],d=2*(2*b-a-c);if(d>0) bo+=(c-a)/d;}
        const p=sampleRate/bo; if(p<MIN_FREQ||p>MAX_FREQ) return null; return p;
    }
}

class AudioEngine{
    constructor(){this.ctx=null;this.micStream=null;this.micSource=null;this.processor=null;this.refSource=null;this.refGain=null;this.detector=new PitchDetector();this.onRefAnalyzed=null;this.isSinging=false;this.startTime=0;this._refDuration=0;}
    ensureContext(){if(!this.ctx) this.ctx=new(window.AudioContext||window.webkitAudioContext)();if(this.ctx.state==='suspended') this.ctx.resume();return this.ctx;}
    async analyzeReferenceFromFile(file){
        const ctx=this.ensureContext();
        const ab=file instanceof ArrayBuffer?file:await file.arrayBuffer();
        const audioBuf=await ctx.decodeAudioData(ab);
        this._refDuration=audioBuf.duration;
        const ch=audioBuf.getChannelData(0), sr=audioBuf.sampleRate, hs=Math.floor(sr*HOP_MS/1000);
        const tf=Math.floor((ch.length-FFT_SIZE)/hs); const res=[]; const tb=new Float64Array(FFT_SIZE);
        for(let i=0;i<tf;i++){const o=i*hs;for(let j=0;j<FFT_SIZE;j++) tb[j]=ch[o+j];const p=this.detector.detect(tb,sr);res.push({time:o/sr,pitch:p,midi:p?freqToMidi(p):null,active:p!==null});if(i%20===0&&this.onRefAnalyzed) this.onRefAnalyzed(i/tf);}
        for(let i=1;i<res.length-1;i++){if(res[i].active&&!res[i-1].active&&!res[i+1].active){res[i].active=false;res[i].pitch=null;res[i].midi=null;}}
        for(let i=1;i<res.length-1;i++){if(!res[i].active&&res[i-1].active){let ge=i;while(ge<res.length&&!res[ge].active) ge++;if(ge-i<5&&ge<res.length&&res[ge].active){const sp=res[i-1].midi,ep=res[ge].midi;for(let j=0;j<ge-i;j++){const t=(j+1)/(ge-i+1),md=sp+(ep-sp)*t;res[i+j]={...res[i+j],midi:md,pitch:midiToFreq(md),active:true};}}}}
        for(let i=1;i<res.length-1;i++){if(res[i-1].active&&res[i].active&&res[i+1].active){const a=(res[i-1].midi+res[i].midi+res[i+1].midi)/3;res[i].midi=a;res[i].pitch=midiToFreq(a);}}
        return res;
    }
    async startMic(onPitch){
        const ctx=this.ensureContext();
        this.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:44100}});
        this.micSource=ctx.createMediaStreamSource(this.micStream);
        this.processor=ctx.createScriptProcessor(FFT_SIZE,1,1);
        this.micSource.connect(this.processor);
        this.processor.connect(ctx.destination);
        this.processor.onaudioprocess=(e)=>{const i=e.inputBuffer.getChannelData(0);const p=this.detector.detect(i,ctx.sampleRate);if(onPitch) onPitch(p);};
        this.isSinging=true;
    }
    stopMic(){this.isSinging=false;if(this.processor){try{this.processor.disconnect()}catch(e){}this.processor=null}if(this.micSource){try{this.micSource.disconnect()}catch(e){}this.micSource=null}if(this.micStream){this.micStream.getTracks().forEach(t=>t.stop());this.micStream=null}}
    createRefSource(audioBuffer,startOffset){const ctx=this.ensureContext();this.refSource=ctx.createBufferSource();this.refSource.buffer=audioBuffer;this.refGain=ctx.createGain();this.refGain.gain.value=0.8;this.refSource.connect(this.refGain);this.refGain.connect(ctx.destination);this.refSource.start(0,startOffset||0);this.startTime=ctx.currentTime-(startOffset||0);}
    stopReference(){if(this.refSource){try{this.refSource.stop()}catch(e){}try{this.refSource.disconnect()}catch(e){}this.refSource=null}if(this.refGain){try{this.refGain.disconnect()}catch(e){}this.refGain=null}}
    getCurrentTime(){if(!this.ctx||!this.refSource) return 0;const t=this.ctx.currentTime-this.startTime;return t<0?0:t;}
    getRefDuration(){return this._refDuration;}
    destroy(){this.stopReference();this.stopMic();if(this.ctx){this.ctx.close();this.ctx=null;}}
}

class Visualizer{
    constructor(canvas){
        this.canvas=canvas;this.ctx=canvas.getContext('2d');this.refData=[];this.userData=[];this.currentTime=0;this.songDuration=0;
        this.dpr=Math.min(window.devicePixelRatio||1,2);this.noteRange=MAX_MIDI-MIN_MIDI;this._resize();
        this._boundResize=this._resize.bind(this);window.addEventListener('resize',this._boundResize);
    }
    _resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.canvas.width=r.width*this.dpr;this.canvas.height=r.height*this.dpr;this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.width=r.width;this.height=r.height;}
    setReferenceData(data,dur){this.refData=data||[];this.songDuration=dur||0;}
    clearUserData(){this.userData=[];}
    addUserPitch(time,pitch){const midi=pitch?clamp(freqToMidi(pitch),MIN_MIDI-2,MAX_MIDI+2):null;this.userData.push({time,pitch,midi});const c=time-15;while(this.userData.length>0&&this.userData[0].time<c)this.userData.shift();}
    mapTimeToX(time){const rt=time-this.currentTime;return this.width*0.15+rt*(this.width*0.75)/10;}
    mapMidiToY(midi){const r=(midi-MIN_MIDI)/this.noteRange,p=this.height*0.08;return this.height-p-r*(this.height-2*p);}
    render(){
        const ctx=this.ctx,w=this.width,h=this.height;if(w===0||h===0)return;
        ctx.clearRect(0,0,w,h);const lt=this.currentTime-PAST_SECS,rt=this.currentTime+PREVIEW_SECS;
        ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;ctx.font='9px sans-serif';ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,0.2)';
        for(let m=Math.ceil(MIN_MIDI/2)*2;m<=MAX_MIDI;m+=2){const y=this.mapMidiToY(m);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();if(m%12===0) ctx.fillText(noteName(m),w-6,y+3);}
        if(this.refData.length===0) return;
        this._drawLine(this.refData,true,lt,rt);this._drawLine(this.userData,false,lt,rt);
        const px=this.mapTimeToX(this.currentTime);if(px>=0&&px<=w){ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();ctx.setLineDash([]);}
    }
    _drawLine(data,isRef,lt,rt){
        const ctx=this.ctx;let si=0,ei=data.length-1;
        while(si<data.length&&data[si].time<lt)si++;while(ei>=0&&data[ei].time>rt)ei--;if(si>=ei)return;
        const ac=isRef?'rgba(0, 212, 255,':'rgba(255, 107, 157,';const dc=isRef?'rgba(0, 150, 200,':'rgba(200, 80, 120,';
        ctx.lineJoin='round';ctx.lineCap='round';const pp=[],fp=[];
        for(let i=si;i<=ei;i++){const d=data[i];if(!d||!d.midi){if(pp.length>1)this._drawPoly(pp,ac+'0.8)',isRef?4:3);if(fp.length>1)this._drawPoly(fp,dc+'0.35)',isRef?3:2);pp.length=0;fp.length=0;continue;}
        const x=this.mapTimeToX(d.time),y=this.mapMidiToY(d.midi);if(x<-20||x>this.width+20)continue;
        if(d.time<=this.currentTime){if(fp.length>1){this._drawPoly(fp,dc+'0.35)',isRef?3:2);fp.length=0;}pp.push({x,y});}
        else{if(pp.length>1){this._drawPoly(pp,ac+'0.8)',isRef?4:3);pp.length=0;}fp.push({x,y});}}
        if(pp.length>1)this._drawPoly(pp,ac+'0.8)',isRef?4:3);if(fp.length>1)this._drawPoly(fp,dc+'0.35)',isRef?3:2);
        if(isRef&&pp.length>1){ctx.save();ctx.strokeStyle='rgba(0,212,255,0.12)';ctx.lineWidth=10;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();ctx.moveTo(pp[0].x,pp[0].y);for(let i=1;i<pp.length;i++)ctx.lineTo(pp[i].x,pp[i].y);ctx.stroke();ctx.restore();}
    }
    _drawPoly(pts,color,w){const ctx=this.ctx;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();ctx.restore();}
    destroy(){window.removeEventListener('resize',this._boundResize);}
}

class Scorer{
    calculate(refData,userData){
        if(!refData||refData.length===0) return{pitchScore:0,rhythmScore:0,totalScore:0};
        let tf=0,pd=0,ri=0;
        for(let u=0;u<userData.length;u++){const ud=userData[u];if(!ud||!ud.midi)continue;while(ri<refData.length-1&&refData[ri+1].time<ud.time)ri++;const rd=refData[ri];if(!rd||!rd.midi){tf++;pd+=3;continue;}tf++;pd+=Math.min(Math.abs(ud.midi-rd.midi),6);}
        let mf=0,raf=0;
        for(let r=0;r<refData.length;r++){if(refData[r].active){raf++;let found=false;for(let u=0;u<userData.length;u++){if(userData[u]&&userData[u].midi&&Math.abs(userData[u].time-refData[r].time)<0.12){found=true;break;}}if(!found)mf++;}}
        const ad=tf>0?pd/tf:6,ps=Math.max(0,Math.min(100,(1-ad/6)*100)),rs=Math.max(0,Math.min(100,(1-mf/Math.max(raf,1))*100));
        return{pitchScore:Math.round(ps),rhythmScore:Math.round(rs),totalScore:Math.round(ps*0.6+rs*0.4)};
    }
}

class LiveScore{
    constructor(){this.buffer=[];this.maxLen=50;}
    add(rm,um){if(rm&&um){this.buffer.push(Math.min(Math.abs(um-rm),6));if(this.buffer.length>this.maxLen)this.buffer.shift();}}
    getScore(){if(this.buffer.length<5)return null;const a=this.buffer.reduce((a,b)=>a+b,0)/this.buffer.length;return Math.round(Math.max(0,Math.min(100,(1-a/6)*100)));}
    reset(){this.buffer=[];}
}

class App{
    constructor(){
        this.engine=new AudioEngine();this.visualizer=new Visualizer(document.getElementById('pitchCanvas'));this.scorer=new Scorer();this.liveScore=new LiveScore();
        this.songFiles={};this.songListArr=[];this.selectedSong=null;this.refData=[];this.audioBuffer=null;this.state='idle';this.userPitchHistory=[];this.isPlaying=false;
        this.singMode='accompanied';this.singStartTime=0;
        this.isServer=window.location.protocol.startsWith('http');
        this.$=id=>document.getElementById(id);
        this.songList=this.$('songList');this.loadingOverlay=this.$('loadingOverlay');this.loadingText=this.$('loadingText');this.loadingProgress=this.$('loadingProgress');
        this.emptyState=this.$('emptyState');this.currentSong=this.$('currentSong');this.statusBadge=this.$('statusBadge');this.btnPlay=this.$('btnPlay');this.btnSing=this.$('btnSing');
        this.btnStop=this.$('btnStop');this.songCount=this.$('songCount');this.livePitchScore=this.$('livePitchScore');this.liveProgress=this.$('liveProgress');
        this.resultPanel=this.$('resultPanel');this.pitchScoreEl=this.$('pitchScore');this.rhythmScoreEl=this.$('rhythmScore');this.totalScoreEl=this.$('totalScore');
        this.sidebar=this.$('sidebar');this.sidebarToggle=this.$('sidebarToggle');this.sidebarBackdrop=this.$('sidebarBackdrop');
        this.backBtn=this.$('backBtn');this.btnFolder=this.$('btnFolder');this.dirPicker=this.$('dirPicker');
        this.modeBtns=document.querySelectorAll('.mode-btn');
        this.btnPlay.addEventListener('click',()=>this.onPlay());this.btnSing.addEventListener('click',()=>this.onSing());this.btnStop.addEventListener('click',()=>this.onStop());
        this.sidebarToggle.addEventListener('click',()=>this.toggleSidebar());this.sidebarBackdrop.addEventListener('click',()=>this.closeSidebar());
        this.btnFolder.addEventListener('click',()=>this.dirPicker.click());this.backBtn.addEventListener('click',()=>this.goBack());
        this.dirPicker.addEventListener('change',(e)=>this.onFolderSelected(e));
        this.modeBtns.forEach(btn=>btn.addEventListener('click',()=>this.switchMode(btn.dataset.mode)));
        this.setState('idle');
        if(this.isServer){this.loadSongsFromServer();this.btnFolder.style.display='none';}
        this._animLoop();
    }
    switchMode(mode){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.singMode=mode;
        this.modeBtns.forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));
    }
    async loadSongsFromServer(){
        try{
            const resp=await fetch('audio/songs.json');
            const songs=await resp.json();
            this.songFiles={};
            this.songListArr=songs.map(s=>s.name).sort();
            songs.forEach(s=>{this.songFiles[s.name]=s;});
            this.songCount.textContent=this.songListArr.length;
            this.renderSongList();
            if(this.songListArr.length>0) this.selectSong(this.songListArr[0]);
        }catch(e){console.error('Failed to load songs from server:',e);this.songList.innerHTML='<div style="padding:30px 20px;text-align:center;color:var(--text-muted);font-size:13px;">加载歌曲列表失败<br>请在浏览器控制台查看具体错误</div>';}
    }
    onFolderSelected(e){
        const files=e.target.files;if(!files||files.length===0)return;
        const mp3s={};const names=[];
        for(let i=0;i<files.length;i++){
            const f=files[i];if(f.name.toLowerCase().endsWith('.mp3')||f.name.toLowerCase().endsWith('.wav')){
                mp3s[f.name]=f;names.push(f.name);
            }
        }
        if(names.length===0){alert('未找到 MP3 文件');return;}
        this.songFiles=mp3s;this.songListArr=names.sort();
        this.btnFolder.textContent='已加载 ' + names.length + ' 首歌曲';
        this.btnFolder.classList.add('loaded');
        this.songCount.textContent=names.length;
        this.renderSongList();
        if(names.length>0) this.selectSong(names[0]);
    }
    renderSongList(){
        this.songList.innerHTML='';
        this.songListArr.forEach(name=>{
            const item=document.createElement('div');
            item.className='song-item'+(this.selectedSong===name?' active':'');
            const f=this.songFiles[name];
            const meta=f&&f.size?((f.size>1048576?Math.round(f.size/1048576)+' MB':Math.round(f.size/1024)+' KB')):'';
            item.innerHTML='<div class="song-icon">&#9835;</div><div class="song-info"><div class="song-name">'+name.replace('.mp3','').replace('.wav','')+'</div><div class="song-meta">'+meta+'</div></div><div class="song-check">'+(this.selectedSong===name?'&#10003;':'')+'</div>';
            item.addEventListener('click',()=>this.selectSong(name));
            this.songList.appendChild(item);
        });
    }
    async selectSong(name){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.selectedSong=name;this.renderSongList();
        this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge loading">分析中...</span>';
        this.resultPanel.classList.remove('show');this.visualizer.clearUserData();this.userPitchHistory=[];this.liveScore.reset();this.setState('loading');
        try{
            this.showLoading('正在解码音频...',0);
            let fileOrBuf=this.songFiles[name];
            if(this.isServer&&fileOrBuf&&fileOrBuf.name){
                // Server mode: fetch MP3 via HTTP
                const resp=await fetch('audio/'+encodeURIComponent(name));
                fileOrBuf=await resp.arrayBuffer();
            }
            this.showLoading('正在分析音高轮廓...',30);
            this.engine.onRefAnalyzed=p=>this.showLoading('正在提取旋律线...',50+Math.round(p*40));
            this.refData=await this.engine.analyzeReferenceFromFile(fileOrBuf);
            // Decode audio buffer for playback
            const ctx=this.engine.ensureContext();
            const buf=fileOrBuf instanceof ArrayBuffer?fileOrBuf:await fileOrBuf.arrayBuffer();
            this.audioBuffer=await ctx.decodeAudioData(buf);
            this.showLoading('正在渲染可视化...',95);
            await new Promise(r=>setTimeout(r,100));
            this.visualizer.setReferenceData(this.refData,this.audioBuffer.duration);
            this.setState('loaded');
            this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge ready">已就绪</span>';
            this.hideLoading();this.emptyState.style.display='none';this.backBtn.classList.add('show');
        }catch(e){console.error(e);this.hideLoading();this.setState('idle');this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge">加载失败</span>';}
    }
    goBack(){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.selectedSong=null;this.audioBuffer=null;this.refData=[];this.visualizer.setReferenceData([]);this.visualizer.clearUserData();
        this.currentSong.innerHTML='未选择歌曲 <span class="status-badge">就绪</span>';this.emptyState.style.display='flex';
        this.backBtn.classList.remove('show');this.resultPanel.classList.remove('show');this.setState('idle');
        this.livePitchScore.textContent='--';this.liveProgress.textContent='0%';
        this.renderSongList();
    }
    onPlay(){
        if(!this.audioBuffer||!this.refData) return;
        if(this.isPlaying){
            this.isPlaying=false;this.engine.stopReference();
            this.btnPlay.innerHTML='<span class="btn-icon">&#9654;</span> 播放示范';
            this.statusBadge.className='status-badge';this.statusBadge.textContent='已暂停';return;
        }
        this.isPlaying=true;const offset=this.engine.getCurrentTime();
        this.engine.createRefSource(this.audioBuffer,offset);
        this.btnPlay.innerHTML='<span class="btn-icon">&#10074;&#10074;</span> 暂停';
        this.statusBadge.className='status-badge';this._updatePlaybackLoop();
    }
    _getCurrentTime(){
        if(this.singMode==='accompanied') return this.engine.getCurrentTime();
        return (performance.now()-this.singStartTime)/1000;
    }
    _getDuration(){return this.engine.getRefDuration();}
    async onSing(){
        if(!this.audioBuffer||!this.refData){this.selectSong(this.selectedSong);return;}
        if(this.state==='singing') return;
        try{
            this.engine.stopReference();this.engine.stopMic();this.visualizer.clearUserData();this.userPitchHistory=[];this.liveScore.reset();
            this.resultPanel.classList.remove('show');this.livePitchScore.textContent='--';this.liveProgress.textContent='0%';
            this.setState('singing');
            const modeLabel=this.singMode==='accompanied'?'演唱中…':'清唱中…';
            this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> '+modeLabel;this.btnSing.classList.add('recording');
            this.statusBadge.className='status-badge singing';this.statusBadge.textContent=this.singMode==='accompanied'?'有伴奏演唱':'无伴奏清唱';
            this.btnPlay.disabled=true;
            await this.engine.startMic((pitch)=>{
                const time=this._getCurrentTime();const midi=pitch?freqToMidi(pitch):null;
                this.userPitchHistory.push({time,pitch,midi});this.visualizer.addUserPitch(time,pitch);
                const rt=this._getRefAtTime(time);if(rt&&midi) this.liveScore.add(rt.midi,midi);
                const s=this.liveScore.getScore();if(s!==null){this.livePitchScore.textContent=s+'%';this.livePitchScore.className='score-value '+(s>=80?'good':s>=60?'ok':'bad');}
            });
            if(this.singMode==='accompanied'){
                this.engine.createRefSource(this.audioBuffer,0);
            } else {
                this.singStartTime=performance.now();
            }
            this.isPlaying=true;
        }catch(e){console.error(e);this.setState('loaded');this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> 开始演唱';this.btnSing.classList.remove('recording');this.statusBadge.textContent='麦克风访问被拒绝';this.btnPlay.disabled=false;alert('无法访问麦克风，请在浏览器设置中允许麦克风权限后重试。');}
    }
    onStop(){
        this.isPlaying=false;this.engine.stopReference();this.engine.stopMic();
        this.btnPlay.innerHTML='<span class="btn-icon">&#9654;</span> 播放示范';this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> 开始演唱';
        this.btnSing.classList.remove('recording');this.btnPlay.disabled=false;
        if(this.state==='singing') this.calculateFinalScore();
        this.setState('loaded');if(this.selectedSong){this.statusBadge.className='status-badge ready';this.statusBadge.textContent='已就绪';}
    }
    calculateFinalScore(){
        const r=this.scorer.calculate(this.refData,this.userPitchHistory);
        this.pitchScoreEl.textContent=r.pitchScore+'%';this.pitchScoreEl.style.color=r.pitchScore>=80?'var(--success)':r.pitchScore>=60?'var(--warning)':'var(--danger)';
        this.rhythmScoreEl.textContent=r.rhythmScore+'%';this.rhythmScoreEl.style.color=r.rhythmScore>=80?'var(--success)':r.rhythmScore>=60?'var(--warning)':'var(--danger)';
        this.totalScoreEl.textContent=r.totalScore+'%';this.totalScoreEl.style.color=r.totalScore>=80?'var(--success)':r.totalScore>=60?'var(--warning)':'var(--danger)';
        this.livePitchScore.textContent=r.pitchScore+'%';this.livePitchScore.className='score-value '+(r.pitchScore>=80?'good':r.pitchScore>=60?'ok':'bad');
        this.resultPanel.classList.add('show');this.statusBadge.className='status-badge done';
        const modeTag=this.singMode==='accompanied'?'有伴奏':'无伴奏';
        this.statusBadge.textContent=modeTag+' - '+r.totalScore+'%';
        setTimeout(()=>{this.liveProgress.textContent='100%';},200);
    }
    _getRefAtTime(time){if(!this.refData||this.refData.length===0)return null;let lo=0,hi=this.refData.length-1;while(lo<hi){const m=Math.floor((lo+hi+1)/2);if(this.refData[m].time<=time) lo=m;else hi=m-1;}return this.refData[lo];}
    _updatePlaybackLoop(){if(!this.isPlaying)return;const t=this._getCurrentTime(),d=this._getDuration();if(t>=d){this.onStop();return;}this.visualizer.currentTime=t;this.liveProgress.textContent=Math.round((t/d)*100)+'%';requestAnimationFrame(()=>this._updatePlaybackLoop());}
    _animLoop(){if(this.isPlaying||this.state==='singing'){const t=this._getCurrentTime();this.visualizer.currentTime=t;}this.visualizer.render();requestAnimationFrame(()=>this._animLoop());}
    setState(s){this.state=s;this.btnPlay.disabled=!(s==='loaded'||s==='playing');this.btnSing.disabled=!(s==='loaded');this.btnStop.disabled=!(s==='singing'||s==='playing');}
    showLoading(text,p){this.loadingOverlay.classList.add('show');this.loadingText.textContent=text||'处理中...';if(p!==undefined)this.loadingProgress.style.width=p+'%';}
    hideLoading(){this.loadingOverlay.classList.remove('show');}
    toggleSidebar(){this.sidebar.classList.toggle('open');this.sidebarBackdrop.classList.toggle('show');}
    closeSidebar(){this.sidebar.classList.remove('open');this.sidebarBackdrop.classList.remove('show');}
}
document.addEventListener('DOMContentLoaded',()=>{window.app=new App();});


function noteName(midi){const n=Math.round(midi);return NOTE_NAMES[n%12]+Math.floor(n/12-1);}
function clamp(v,m,M){return Math.max(m,Math.min(M,v));}

class PitchDetector{
    detect(buffer,sampleRate){
        const size=buffer.length, maxOffset=Math.floor(size/2);
        let rms=0; for(let i=0;i<size;i++) rms+=buffer[i]*buffer[i];
        rms=Math.sqrt(rms/size); if(rms<RMS_THRESHOLD) return null;
        const corr=new Float64Array(maxOffset);
        for(let o=0;o<maxOffset;o++){let s=0;for(let i=0;i<maxOffset;i++) s+=buffer[i]*buffer[i+o];corr[o]=s;}
        const n0=corr[0]||1; let fz=-1;
        for(let o=1;o<maxOffset;o++){if(corr[o-1]/n0>=0&&corr[o]/n0<0){fz=o;break;}}
        if(fz<2) return null; let bo=fz, mc=0;
        for(let o=fz;o<maxOffset;o++){if(corr[o]>mc){mc=corr[o];bo=o;}}
        if(mc/n0<0.15) return null;
        if(bo>1&&bo<maxOffset-2){const a=corr[bo-1],b=corr[bo],c=corr[bo+1],d=2*(2*b-a-c);if(d>0) bo+=(c-a)/d;}
        const p=sampleRate/bo; if(p<MIN_FREQ||p>MAX_FREQ) return null; return p;
    }
}

class AudioEngine{
    constructor(){this.ctx=null;this.micStream=null;this.micSource=null;this.processor=null;this.refSource=null;this.refGain=null;this.detector=new PitchDetector();this.onRefAnalyzed=null;this.isSinging=false;this.startTime=0;this._refDuration=0;}
    ensureContext(){if(!this.ctx) this.ctx=new(window.AudioContext||window.webkitAudioContext)();if(this.ctx.state==='suspended') this.ctx.resume();return this.ctx;}
    async analyzeReferenceFromFile(file){
        const ctx=this.ensureContext();
        const ab=file instanceof ArrayBuffer?file:await file.arrayBuffer();
        const audioBuf=await ctx.decodeAudioData(ab);
        this._refDuration=audioBuf.duration;
        const ch=audioBuf.getChannelData(0), sr=audioBuf.sampleRate, hs=Math.floor(sr*HOP_MS/1000);
        const tf=Math.floor((ch.length-FFT_SIZE)/hs); const res=[]; const tb=new Float64Array(FFT_SIZE);
        for(let i=0;i<tf;i++){const o=i*hs;for(let j=0;j<FFT_SIZE;j++) tb[j]=ch[o+j];const p=this.detector.detect(tb,sr);res.push({time:o/sr,pitch:p,midi:p?freqToMidi(p):null,active:p!==null});if(i%20===0&&this.onRefAnalyzed) this.onRefAnalyzed(i/tf);}
        for(let i=1;i<res.length-1;i++){if(res[i].active&&!res[i-1].active&&!res[i+1].active){res[i].active=false;res[i].pitch=null;res[i].midi=null;}}
        for(let i=1;i<res.length-1;i++){if(!res[i].active&&res[i-1].active){let ge=i;while(ge<res.length&&!res[ge].active) ge++;if(ge-i<5&&ge<res.length&&res[ge].active){const sp=res[i-1].midi,ep=res[ge].midi;for(let j=0;j<ge-i;j++){const t=(j+1)/(ge-i+1),md=sp+(ep-sp)*t;res[i+j]={...res[i+j],midi:md,pitch:midiToFreq(md),active:true};}}}}
        for(let i=1;i<res.length-1;i++){if(res[i-1].active&&res[i].active&&res[i+1].active){const a=(res[i-1].midi+res[i].midi+res[i+1].midi)/3;res[i].midi=a;res[i].pitch=midiToFreq(a);}}
        return res;
    }
    async startMic(onPitch){
        const ctx=this.ensureContext();
        this.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:44100}});
        this.micSource=ctx.createMediaStreamSource(this.micStream);
        this.processor=ctx.createScriptProcessor(FFT_SIZE,1,1);
        this.micSource.connect(this.processor);
        this.processor.connect(ctx.destination);
        this.processor.onaudioprocess=(e)=>{const i=e.inputBuffer.getChannelData(0);const p=this.detector.detect(i,ctx.sampleRate);if(onPitch) onPitch(p);};
        this.isSinging=true;
    }
    stopMic(){this.isSinging=false;if(this.processor){try{this.processor.disconnect()}catch(e){}this.processor=null}if(this.micSource){try{this.micSource.disconnect()}catch(e){}this.micSource=null}if(this.micStream){this.micStream.getTracks().forEach(t=>t.stop());this.micStream=null}}
    createRefSource(audioBuffer,startOffset){const ctx=this.ensureContext();this.refSource=ctx.createBufferSource();this.refSource.buffer=audioBuffer;this.refGain=ctx.createGain();this.refGain.gain.value=0.8;this.refSource.connect(this.refGain);this.refGain.connect(ctx.destination);this.refSource.start(0,startOffset||0);this.startTime=ctx.currentTime-(startOffset||0);}
    stopReference(){if(this.refSource){try{this.refSource.stop()}catch(e){}try{this.refSource.disconnect()}catch(e){}this.refSource=null}if(this.refGain){try{this.refGain.disconnect()}catch(e){}this.refGain=null}}
    getCurrentTime(){if(!this.ctx||!this.refSource) return 0;const t=this.ctx.currentTime-this.startTime;return t<0?0:t;}
    getRefDuration(){return this._refDuration;}
    destroy(){this.stopReference();this.stopMic();if(this.ctx){this.ctx.close();this.ctx=null;}}
}

class Visualizer{
    constructor(canvas){
        this.canvas=canvas;this.ctx=canvas.getContext('2d');this.refData=[];this.userData=[];this.currentTime=0;this.songDuration=0;
        this.dpr=Math.min(window.devicePixelRatio||1,2);this.noteRange=MAX_MIDI-MIN_MIDI;this._resize();
        this._boundResize=this._resize.bind(this);window.addEventListener('resize',this._boundResize);
    }
    _resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.canvas.width=r.width*this.dpr;this.canvas.height=r.height*this.dpr;this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.width=r.width;this.height=r.height;}
    setReferenceData(data,dur){this.refData=data||[];this.songDuration=dur||0;}
    clearUserData(){this.userData=[];}
    addUserPitch(time,pitch){const midi=pitch?clamp(freqToMidi(pitch),MIN_MIDI-2,MAX_MIDI+2):null;this.userData.push({time,pitch,midi});const c=time-15;while(this.userData.length>0&&this.userData[0].time<c)this.userData.shift();}
    mapTimeToX(time){const rt=time-this.currentTime;return this.width*0.15+rt*(this.width*0.75)/10;}
    mapMidiToY(midi){const r=(midi-MIN_MIDI)/this.noteRange,p=this.height*0.08;return this.height-p-r*(this.height-2*p);}
    render(){
        const ctx=this.ctx,w=this.width,h=this.height;if(w===0||h===0)return;
        ctx.clearRect(0,0,w,h);const lt=this.currentTime-PAST_SECS,rt=this.currentTime+PREVIEW_SECS;
        ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;ctx.font='9px sans-serif';ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,0.2)';
        for(let m=Math.ceil(MIN_MIDI/2)*2;m<=MAX_MIDI;m+=2){const y=this.mapMidiToY(m);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();if(m%12===0) ctx.fillText(noteName(m),w-6,y+3);}
        if(this.refData.length===0) return;
        this._drawLine(this.refData,true,lt,rt);this._drawLine(this.userData,false,lt,rt);
        const px=this.mapTimeToX(this.currentTime);if(px>=0&&px<=w){ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();ctx.setLineDash([]);}
    }
    _drawLine(data,isRef,lt,rt){
        const ctx=this.ctx;let si=0,ei=data.length-1;
        while(si<data.length&&data[si].time<lt)si++;while(ei>=0&&data[ei].time>rt)ei--;if(si>=ei)return;
        const ac=isRef?'rgba(0, 212, 255,':'rgba(255, 107, 157,';const dc=isRef?'rgba(0, 150, 200,':'rgba(200, 80, 120,';
        ctx.lineJoin='round';ctx.lineCap='round';const pp=[],fp=[];
        for(let i=si;i<=ei;i++){const d=data[i];if(!d||!d.midi){if(pp.length>1)this._drawPoly(pp,ac+'0.8)',isRef?4:3);if(fp.length>1)this._drawPoly(fp,dc+'0.35)',isRef?3:2);pp.length=0;fp.length=0;continue;}
        const x=this.mapTimeToX(d.time),y=this.mapMidiToY(d.midi);if(x<-20||x>this.width+20)continue;
        if(d.time<=this.currentTime){if(fp.length>1){this._drawPoly(fp,dc+'0.35)',isRef?3:2);fp.length=0;}pp.push({x,y});}
        else{if(pp.length>1){this._drawPoly(pp,ac+'0.8)',isRef?4:3);pp.length=0;}fp.push({x,y});}}
        if(pp.length>1)this._drawPoly(pp,ac+'0.8)',isRef?4:3);if(fp.length>1)this._drawPoly(fp,dc+'0.35)',isRef?3:2);
        if(isRef&&pp.length>1){ctx.save();ctx.strokeStyle='rgba(0,212,255,0.12)';ctx.lineWidth=10;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();ctx.moveTo(pp[0].x,pp[0].y);for(let i=1;i<pp.length;i++)ctx.lineTo(pp[i].x,pp[i].y);ctx.stroke();ctx.restore();}
    }
    _drawPoly(pts,color,w){const ctx=this.ctx;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();ctx.restore();}
    destroy(){window.removeEventListener('resize',this._boundResize);}
}

class Scorer{
    calculate(refData,userData){
        if(!refData||refData.length===0) return{pitchScore:0,rhythmScore:0,totalScore:0};
        let tf=0,pd=0,ri=0;
        for(let u=0;u<userData.length;u++){const ud=userData[u];if(!ud||!ud.midi)continue;while(ri<refData.length-1&&refData[ri+1].time<ud.time)ri++;const rd=refData[ri];if(!rd||!rd.midi){tf++;pd+=3;continue;}tf++;pd+=Math.min(Math.abs(ud.midi-rd.midi),6);}
        let mf=0,raf=0;
        for(let r=0;r<refData.length;r++){if(refData[r].active){raf++;let found=false;for(let u=0;u<userData.length;u++){if(userData[u]&&userData[u].midi&&Math.abs(userData[u].time-refData[r].time)<0.12){found=true;break;}}if(!found)mf++;}}
        const ad=tf>0?pd/tf:6,ps=Math.max(0,Math.min(100,(1-ad/6)*100)),rs=Math.max(0,Math.min(100,(1-mf/Math.max(raf,1))*100));
        return{pitchScore:Math.round(ps),rhythmScore:Math.round(rs),totalScore:Math.round(ps*0.6+rs*0.4)};
    }
}

class LiveScore{
    constructor(){this.buffer=[];this.maxLen=50;}
    add(rm,um){if(rm&&um){this.buffer.push(Math.min(Math.abs(um-rm),6));if(this.buffer.length>this.maxLen)this.buffer.shift();}}
    getScore(){if(this.buffer.length<5)return null;const a=this.buffer.reduce((a,b)=>a+b,0)/this.buffer.length;return Math.round(Math.max(0,Math.min(100,(1-a/6)*100)));}
    reset(){this.buffer=[];}
}

class App{
    constructor(){
        this.engine=new AudioEngine();this.visualizer=new Visualizer(document.getElementById('pitchCanvas'));this.scorer=new Scorer();this.liveScore=new LiveScore();
        this.songFiles={};this.songListArr=[];this.selectedSong=null;this.refData=[];this.audioBuffer=null;this.state='idle';this.userPitchHistory=[];this.isPlaying=false;
        this.singMode='accompanied';this.singStartTime=0;
        this.isServer=window.location.protocol.startsWith('http');
        this.$=id=>document.getElementById(id);
        this.songList=this.$('songList');this.loadingOverlay=this.$('loadingOverlay');this.loadingText=this.$('loadingText');this.loadingProgress=this.$('loadingProgress');
        this.emptyState=this.$('emptyState');this.currentSong=this.$('currentSong');this.statusBadge=this.$('statusBadge');this.btnPlay=this.$('btnPlay');this.btnSing=this.$('btnSing');
        this.btnStop=this.$('btnStop');this.songCount=this.$('songCount');this.livePitchScore=this.$('livePitchScore');this.liveProgress=this.$('liveProgress');
        this.resultPanel=this.$('resultPanel');this.pitchScoreEl=this.$('pitchScore');this.rhythmScoreEl=this.$('rhythmScore');this.totalScoreEl=this.$('totalScore');
        this.sidebar=this.$('sidebar');this.sidebarToggle=this.$('sidebarToggle');this.sidebarBackdrop=this.$('sidebarBackdrop');
        this.backBtn=this.$('backBtn');this.btnFolder=this.$('btnFolder');this.dirPicker=this.$('dirPicker');
        this.modeBtns=document.querySelectorAll('.mode-btn');
        this.btnPlay.addEventListener('click',()=>this.onPlay());this.btnSing.addEventListener('click',()=>this.onSing());this.btnStop.addEventListener('click',()=>this.onStop());
        this.sidebarToggle.addEventListener('click',()=>this.toggleSidebar());this.sidebarBackdrop.addEventListener('click',()=>this.closeSidebar());
        this.btnFolder.addEventListener('click',()=>this.dirPicker.click());this.backBtn.addEventListener('click',()=>this.goBack());
        this.dirPicker.addEventListener('change',(e)=>this.onFolderSelected(e));
        this.modeBtns.forEach(btn=>btn.addEventListener('click',()=>this.switchMode(btn.dataset.mode)));
        this.setState('idle');
        if(this.isServer){this.loadSongsFromServer();this.btnFolder.style.display='none';}
        this._animLoop();
    }
    switchMode(mode){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.singMode=mode;
        this.modeBtns.forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));
    }
    async loadSongsFromServer(){
        try{
            const resp=await fetch('audio/songs.json');
            const songs=await resp.json();
            this.songFiles={};
            this.songListArr=songs.map(s=>s.name).sort();
            songs.forEach(s=>{this.songFiles[s.name]=s;});
            this.songCount.textContent=this.songListArr.length;
            this.renderSongList();
            if(this.songListArr.length>0) this.selectSong(this.songListArr[0]);
        }catch(e){console.error('Failed to load songs from server:',e);this.songList.innerHTML='<div style="padding:30px 20px;text-align:center;color:var(--text-muted);font-size:13px;">加载歌曲列表失败</div>';}
    }
    onFolderSelected(e){
        const files=e.target.files;if(!files||files.length===0)return;
        const mp3s={};const names=[];
        for(let i=0;i<files.length;i++){
            const f=files[i];if(f.name.toLowerCase().endsWith('.mp3')||f.name.toLowerCase().endsWith('.wav')){
                mp3s[f.name]=f;names.push(f.name);
            }
        }
        if(names.length===0){alert('未找到 MP3 文件');return;}
        this.songFiles=mp3s;this.songListArr=names.sort();
        this.btnFolder.textContent='已加载 ' + names.length + ' 首歌曲';
        this.btnFolder.classList.add('loaded');
        this.songCount.textContent=names.length;
        this.renderSongList();
        if(names.length>0) this.selectSong(names[0]);
    }
    renderSongList(){
        this.songList.innerHTML='';
        this.songListArr.forEach(name=>{
            const item=document.createElement('div');
            item.className='song-item'+(this.selectedSong===name?' active':'');
            const f=this.songFiles[name];
            const meta=f&&f.size?((f.size>1048576?Math.round(f.size/1048576)+' MB':Math.round(f.size/1024)+' KB')):'';
            item.innerHTML='<div class="song-icon">&#9835;</div><div class="song-info"><div class="song-name">'+name.replace('.mp3','').replace('.wav','')+'</div><div class="song-meta">'+meta+'</div></div><div class="song-check">'+(this.selectedSong===name?'&#10003;':'')+'</div>';
            item.addEventListener('click',()=>this.selectSong(name));
            this.songList.appendChild(item);
        });
    }
    async selectSong(name){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.selectedSong=name;this.renderSongList();
        this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge loading">分析中...</span>';
        this.resultPanel.classList.remove('show');this.visualizer.clearUserData();this.userPitchHistory=[];this.liveScore.reset();this.setState('loading');
        try{
            this.showLoading('正在解码音频...',0);
            let fileOrBuf=this.songFiles[name];
            if(this.isServer&&fileOrBuf&&fileOrBuf.name){
                // Server mode: fetch MP3 via HTTP
                const resp=await fetch('audio/'+encodeURIComponent(name));
                fileOrBuf=await resp.arrayBuffer();
            }
            this.showLoading('正在分析音高轮廓...',30);
            this.engine.onRefAnalyzed=p=>this.showLoading('正在提取旋律线...',50+Math.round(p*40));
            this.refData=await this.engine.analyzeReferenceFromFile(fileOrBuf);
            // Decode audio buffer for playback
            const ctx=this.engine.ensureContext();
            const buf=fileOrBuf instanceof ArrayBuffer?fileOrBuf:await fileOrBuf.arrayBuffer();
            this.audioBuffer=await ctx.decodeAudioData(buf);
            this.showLoading('正在渲染可视化...',95);
            await new Promise(r=>setTimeout(r,100));
            this.visualizer.setReferenceData(this.refData,this.audioBuffer.duration);
            this.setState('loaded');
            this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge ready">已就绪</span>';
            this.hideLoading();this.emptyState.style.display='none';this.backBtn.classList.add('show');
        }catch(e){console.error(e);this.hideLoading();this.setState('idle');this.currentSong.innerHTML=name.replace('.mp3','').replace('.wav','')+' <span class="status-badge">加载失败</span>';}
    }
    goBack(){
        if(this.state==='singing'||this.state==='playing') this.onStop();
        this.selectedSong=null;this.audioBuffer=null;this.refData=[];this.visualizer.setReferenceData([]);this.visualizer.clearUserData();
        this.currentSong.innerHTML='未选择歌曲 <span class="status-badge">就绪</span>';this.emptyState.style.display='flex';
        this.backBtn.classList.remove('show');this.resultPanel.classList.remove('show');this.setState('idle');
        this.livePitchScore.textContent='--';this.liveProgress.textContent='0%';
        this.renderSongList();
    }
    onPlay(){
        if(!this.audioBuffer||!this.refData) return;
        if(this.isPlaying){
            this.isPlaying=false;this.engine.stopReference();
            this.btnPlay.innerHTML='<span class="btn-icon">&#9654;</span> 播放示范';
            this.statusBadge.className='status-badge';this.statusBadge.textContent='已暂停';return;
        }
        this.isPlaying=true;const offset=this.engine.getCurrentTime();
        this.engine.createRefSource(this.audioBuffer,offset);
        this.btnPlay.innerHTML='<span class="btn-icon">&#10074;&#10074;</span> 暂停';
        this.statusBadge.className='status-badge';this._updatePlaybackLoop();
    }
    _getCurrentTime(){
        if(this.singMode==='accompanied') return this.engine.getCurrentTime();
        return (performance.now()-this.singStartTime)/1000;
    }
    _getDuration(){return this.engine.getRefDuration();}
    async onSing(){
        if(!this.audioBuffer||!this.refData){this.selectSong(this.selectedSong);return;}
        if(this.state==='singing') return;
        try{
            this.engine.stopReference();this.engine.stopMic();this.visualizer.clearUserData();this.userPitchHistory=[];this.liveScore.reset();
            this.resultPanel.classList.remove('show');this.livePitchScore.textContent='--';this.liveProgress.textContent='0%';
            this.setState('singing');
            const modeLabel=this.singMode==='accompanied'?'演唱中…':'清唱中…';
            this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> '+modeLabel;this.btnSing.classList.add('recording');
            this.statusBadge.className='status-badge singing';this.statusBadge.textContent=this.singMode==='accompanied'?'有伴奏演唱':'无伴奏清唱';
            this.btnPlay.disabled=true;
            await this.engine.startMic((pitch)=>{
                const time=this._getCurrentTime();const midi=pitch?freqToMidi(pitch):null;
                this.userPitchHistory.push({time,pitch,midi});this.visualizer.addUserPitch(time,pitch);
                const rt=this._getRefAtTime(time);if(rt&&midi) this.liveScore.add(rt.midi,midi);
                const s=this.liveScore.getScore();if(s!==null){this.livePitchScore.textContent=s+'%';this.livePitchScore.className='score-value '+(s>=80?'good':s>=60?'ok':'bad');}
            });
            if(this.singMode==='accompanied'){
                this.engine.createRefSource(this.audioBuffer,0);
            } else {
                this.singStartTime=performance.now();
            }
            this.isPlaying=true;
        }catch(e){console.error(e);this.setState('loaded');this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> 开始演唱';this.btnSing.classList.remove('recording');this.statusBadge.textContent='麦克风访问被拒绝';this.btnPlay.disabled=false;alert('无法访问麦克风，请在浏览器设置中允许麦克风权限后重试。');}
    }
    onStop(){
        this.isPlaying=false;this.engine.stopReference();this.engine.stopMic();
        this.btnPlay.innerHTML='<span class="btn-icon">&#9654;</span> 播放示范';this.btnSing.innerHTML='<span class="btn-icon">&#9835;</span> 开始演唱';
        this.btnSing.classList.remove('recording');this.btnPlay.disabled=false;
        if(this.state==='singing') this.calculateFinalScore();
        this.setState('loaded');if(this.selectedSong){this.statusBadge.className='status-badge ready';this.statusBadge.textContent='已就绪';}
    }
    calculateFinalScore(){
        const r=this.scorer.calculate(this.refData,this.userPitchHistory);
        this.pitchScoreEl.textContent=r.pitchScore+'%';this.pitchScoreEl.style.color=r.pitchScore>=80?'var(--success)':r.pitchScore>=60?'var(--warning)':'var(--danger)';
        this.rhythmScoreEl.textContent=r.rhythmScore+'%';this.rhythmScoreEl.style.color=r.rhythmScore>=80?'var(--success)':r.rhythmScore>=60?'var(--warning)':'var(--danger)';
        this.totalScoreEl.textContent=r.totalScore+'%';this.totalScoreEl.style.color=r.totalScore>=80?'var(--success)':r.totalScore>=60?'var(--warning)':'var(--danger)';
        this.livePitchScore.textContent=r.pitchScore+'%';this.livePitchScore.className='score-value '+(r.pitchScore>=80?'good':r.pitchScore>=60?'ok':'bad');
        this.resultPanel.classList.add('show');this.statusBadge.className='status-badge done';
        const modeTag=this.singMode==='accompanied'?'有伴奏':'无伴奏';
        this.statusBadge.textContent=modeTag+' - '+r.totalScore+'%';
        setTimeout(()=>{this.liveProgress.textContent='100%';},200);
    }
    _getRefAtTime(time){if(!this.refData||this.refData.length===0)return null;let lo=0,hi=this.refData.length-1;while(lo<hi){const m=Math.floor((lo+hi+1)/2);if(this.refData[m].time<=time) lo=m;else hi=m-1;}return this.refData[lo];}
    _updatePlaybackLoop(){if(!this.isPlaying)return;const t=this._getCurrentTime(),d=this._getDuration();if(t>=d){this.onStop();return;}this.visualizer.currentTime=t;this.liveProgress.textContent=Math.round((t/d)*100)+'%';requestAnimationFrame(()=>this._updatePlaybackLoop());}
    _animLoop(){if(this.isPlaying||this.state==='singing'){const t=this._getCurrentTime();this.visualizer.currentTime=t;}this.visualizer.render();requestAnimationFrame(()=>this._animLoop());}
    setState(s){this.state=s;this.btnPlay.disabled=!(s==='loaded'||s==='playing');this.btnSing.disabled=!(s==='loaded');this.btnStop.disabled=!(s==='singing'||s==='playing');}
    showLoading(text,p){this.loadingOverlay.classList.add('show');this.loadingText.textContent=text||'处理中...';if(p!==undefined)this.loadingProgress.style.width=p+'%';}
    hideLoading(){this.loadingOverlay.classList.remove('show');}
    toggleSidebar(){this.sidebar.classList.toggle('open');this.sidebarBackdrop.classList.toggle('show');}
    closeSidebar(){this.sidebar.classList.remove('open');this.sidebarBackdrop.classList.remove('show');}
}
document.addEventListener('DOMContentLoaded',()=>{window.app=new App();});
