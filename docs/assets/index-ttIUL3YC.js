var L=Object.defineProperty;var P=(t,e,n)=>e in t?L(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var l=(t,e,n)=>P(t,typeof e!="symbol"?e+"":e,n);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&s(a)}).observe(document,{childList:!0,subtree:!0});function n(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(i){if(i.ep)return;i.ep=!0;const r=n(i);fetch(i.href,r)}})();function O(){return window.Yacewo?Promise.resolve(window.Yacewo):new Promise((t,e)=>{const n=document.createElement("script");n.src="/yacewo/yacewo_engine.js",n.onload=()=>{window.Yacewo?t(window.Yacewo):e(new Error("Yacewo engine failed to export"))},n.onerror=()=>e(new Error("Failed to load yacewo_engine.js")),document.head.appendChild(n)})}function C(t){if(!t.ok||!t.game)throw new Error(t.error??"engine error");return t.game}const S="yacewo-theme";function A(){const t=localStorage.getItem(S);return t==="light"||t==="dark"?t:typeof window<"u"&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function N(t){localStorage.setItem(S,t)}function k(t){document.documentElement.dataset.theme=t}function R(t){return t==="light"?"dark":"light"}function I(t){return t==="light"?"Light":"Dark"}const T={"white-king":"♚","white-queen":"♛","white-rook":"♜","white-bishop":"♝","white-knight":"♞","white-pawn":"♟","black-king":"♚","black-queen":"♛","black-rook":"♜","black-bishop":"♝","black-knight":"♞","black-pawn":"♟"},M={queen:"♛",rook:"♜",bishop:"♝",knight:"♞"};function $(t){const e=t%8+1,n=8-Math.floor(t/8),s=`${String.fromCharCode(96+e)}${n}`;return{file:e,rank:n,alg:s}}function F(t){const e=t.status;switch(e.tag){case"in_progress":return`${m(t.turn)} to move`;case"check":return`${m(e.color??t.turn)} in check — ${m(t.turn)} to move`;case"checkmate":return`${m(e.color==="white"?"black":"white")} wins by checkmate`;case"stalemate":return"Draw by stalemate";case"draw_insufficient":return"Draw by insufficient material";case"draw_agreement":return"Draw by agreement";case"resigned":return`${m(e.color==="white"?"black":"white")} wins — ${m(e.color??"")} resigned`;default:return e.tag}}function m(t){return t&&t.charAt(0).toUpperCase()+t.slice(1)}function Y(t){return t?T[`${t.color}-${t.kind}`]??"":""}class x{constructor(e){l(this,"api");l(this,"root");l(this,"screen","landing");l(this,"theme",A());l(this,"game",null);l(this,"mode","classical");l(this,"seedInput","");l(this,"fenInput","");l(this,"selected",null);l(this,"error","");l(this,"helpOpen",!1);l(this,"pendingPromo",null);l(this,"notation","");this.root=e,k(this.theme)}async boot(){this.root.innerHTML='<div class="loading"><p>Loading YACEWO engine…</p></div>';try{this.api=await O(),this.render()}catch(e){this.root.innerHTML=`<div class="boot-error"><h1>Could not load engine</h1><p>${e instanceof Error?e.message:String(e)}</p></div>`}}setGame(e){this.game=e,this.selected=null,this.error="",this.pendingPromo=null}tryResult(e,n="play"){if(!e.ok||!e.game){this.error=e.error??"Something went wrong",this.render();return}this.setGame(e.game),this.screen=n,this.render()}legalTargets(e){return this.game?this.game.legalMoves.filter(n=>n.kind==="normal"&&n.from===e):[]}castlesFrom(e){if(!this.game)return[];const s=this.game.turn==="white"?"e1":"e8";return e!==s?[]:this.game.legalMoves.filter(i=>i.kind==="castle")}onSquareClick(e){if(!this.game||this.game.isOver)return;const n=this.game.board.findIndex((i,r)=>$(r).alg===e),s=n>=0?this.game.board[n]:null;if(!this.selected){s&&s.color===this.game.turn&&(this.selected=e,this.error="",this.render());return}if(this.selected===e){this.selected=null,this.render();return}if(s&&s.color===this.game.turn){this.selected=e,this.render();return}this.attemptMove(this.selected,e)}attemptMove(e,n){if(!this.game)return;const s=this.castlesFrom(e);for(const a of s){const h=this.game.turn==="white"?"1":"8",p=a.side==="king"?`g${h}`:`c${h}`;if(n===p){this.tryResult(this.api.applyCastle(a.side));return}}const i=this.legalTargets(e).filter(a=>a.to===n);if(i.length===0){this.error="Illegal move",this.selected=null,this.render();return}const r=i.some(a=>a.promotion);if(r&&i.every(a=>a.promotion==="queen"),r){this.pendingPromo={from:e,to:n},this.render();return}this.tryResult(this.api.applyMove(e,n,null))}applyPromo(e){if(!this.pendingPromo)return;const{from:n,to:s}=this.pendingPromo;this.tryResult(this.api.applyMove(n,s,e))}renderTopbar(e){return`
      <header class="topbar">
        ${e?'<a class="brand-mark" href="#/" data-nav="landing">YACEWO</a>':'<div class="brand-mark">YACEWO</div>'}
        <button type="button" class="theme-btn" data-action="theme">${I(this.theme)}</button>
      </header>
    `}renderLanding(){return`
      ${this.renderTopbar(!1)}
      <main class="landing">
        <section class="landing-hero">
          <h1>YACEWO</h1>
          <p>(Yet) Another Chess Engine Written in OCaml</p>
        </section>
        <section class="mode-select">
          <div class="mode-row">
            <button type="button" class="mode-btn ${this.mode==="classical"?"active":""}" data-mode="classical">
              <span class="mode-name">Classical</span>
              <span class="mode-hint">Standard starting armies</span>
            </button>
            <button type="button" class="mode-btn ${this.mode==="anarchy"?"active":""}" data-mode="anarchy">
              <span class="mode-name">Anarchy</span>
              <span class="mode-hint">Seeded random armies</span>
            </button>
          </div>
          ${this.mode==="anarchy"?`<div class="field">
                  <label for="seed">Seed (blank = random)</label>
                  <input id="seed" inputmode="numeric" placeholder="42" value="${E(this.seedInput)}" />
                </div>`:""}
          <button type="button" class="primary-btn" data-action="start">Play</button>
          <div class="divider"><span>or load FEN</span></div>
          <div class="field">
            <label for="fen">FEN</label>
            <textarea id="fen" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">${d(this.fenInput)}</textarea>
            <button type="button" class="ghost-btn" data-action="load-fen">Load FEN</button>
          </div>
          ${this.error?`<div class="error-line">${d(this.error)}</div>`:""}
        </section>
      </main>
    `}renderBoard(){if(!this.game)return"";const e=new Set;if(this.selected){for(const r of this.legalTargets(this.selected))e.add(r.to);for(const r of this.castlesFrom(this.selected)){const a=this.game.turn==="white"?"1":"8";e.add(r.side==="king"?`g${a}`:`c${a}`)}}const n=this.game.board.map((r,a)=>{const{file:h,rank:p,alg:u}=$(a),b=["sq",(h+p)%2===1?"light":"dark",this.selected===u?"selected":"",e.has(u)?"legal":"",r?"has-piece":""].filter(Boolean).join(" "),g=Y(r);return`<button type="button" class="${b}" data-sq="${u}" aria-label="${u}">${g?`<span class="piece ${(r==null?void 0:r.color)??""}">${g}</span>`:""}</button>`}).join(""),s=[8,7,6,5,4,3,2,1].map(r=>`<span>${r}</span>`).join(""),i=["a","b","c","d","e","f","g","h"].map(r=>`<span>${r}</span>`).join("");return`
      <div class="board-plate">
        <div class="board-stage">
          <div class="rank-gutter" aria-hidden="true">${s}</div>
          <div class="board" role="grid" aria-label="Chess board">${n}</div>
          <div></div>
          <div class="file-gutter" aria-hidden="true">${i}</div>
        </div>
      </div>
    `}renderPromo(){return this.pendingPromo?`
      <div class="promo" role="dialog" aria-label="Choose promotion">
        <div class="promo-card">
          <strong>Promote pawn</strong>
          <div class="promo-row">
            ${["queen","rook","bishop","knight"].map(e=>`<button type="button" data-promo="${e}" aria-label="${e}">${M[e]}</button>`).join("")}
          </div>
          <button type="button" class="ghost-btn" data-action="cancel-promo">Cancel</button>
        </div>
      </div>
    `:""}renderPlay(){if(!this.game)return this.renderLanding();const e=this.game,n=e.seed!=null?"status-meta anarchy":"status-meta",s=e.seed!=null?`Anarchy · seed ${e.seed}`:"Classical";return`
      ${this.renderTopbar(!0)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${d(F(e))}</span>
            <span class="${n}">${d(s)}</span>
          </div>
          ${this.renderBoard()}
          <form class="algebraic" data-form="notation">
            <input name="notation" placeholder="e4 · Nf3 · O-O" autocomplete="off" value="${E(this.notation)}" ${e.isOver?"disabled":""} />
            <button class="primary-btn" type="submit" ${e.isOver?"disabled":""}>Move</button>
          </form>
          <div class="error-line">${d(this.error)}</div>
        </section>
        <aside class="panel">
          <h2>Game</h2>
          <div class="panel-section">
            <div class="label">Moves</div>
            <div class="move-list">${d(e.moveList||"No moves yet.")}</div>
          </div>
          <div class="panel-section">
            <div class="label">FEN</div>
            <div class="fen-box">${d(e.fen)}</div>
            <div class="actions">
              <button type="button" class="action-btn" data-action="copy-fen">Copy FEN</button>
            </div>
          </div>
          ${e.seed!=null?`<div class="panel-section"><div class="label">Seed</div><div class="seed-box">${e.seed}</div></div>`:""}
          <div class="actions">
            <button type="button" class="action-btn" data-action="undo" ${e.isOver?"disabled":""}>Undo</button>
            <button type="button" class="action-btn" data-action="draw" ${e.isOver?"disabled":""}>Draw</button>
            <button type="button" class="action-btn" data-action="resign" ${e.isOver?"disabled":""}>Resign</button>
            <button type="button" class="action-btn" data-action="help">Help</button>
            <button type="button" class="action-btn" data-action="new">New game</button>
          </div>
          ${this.helpOpen?`<div class="help">
                  <strong>Help</strong>
                  <ul>
                    <li>Click a piece, then a highlighted square.</li>
                    <li>Or type notation: e4, Nf3, O-O, exd5, e8=Q.</li>
                    <li>Undo takes back the last half-move.</li>
                    <li>Draw offers; the other side accepts with Draw or declines by moving.</li>
                    <li>FEN can include an optional Anarchy seed as a 7th field.</li>
                  </ul>
                </div>`:""}
        </aside>
      </main>
      ${this.renderPromo()}
    `}render(){this.root.innerHTML=this.screen==="landing"?this.renderLanding():this.renderPlay(),this.bind()}bind(){var i,r,a,h,p,u,v,b,g,y,w;(i=this.root.querySelector("[data-action='theme']"))==null||i.addEventListener("click",()=>{this.theme=R(this.theme),N(this.theme),k(this.theme),this.render()}),(r=this.root.querySelector("[data-nav='landing']"))==null||r.addEventListener("click",o=>{o.preventDefault(),this.screen="landing",this.error="",this.render()}),this.root.querySelectorAll("[data-mode]").forEach(o=>{o.addEventListener("click",()=>{this.mode=o.dataset.mode==="anarchy"?"anarchy":"classical",this.error="",this.render()})});const e=this.root.querySelector("#seed");e==null||e.addEventListener("input",()=>{this.seedInput=e.value});const n=this.root.querySelector("#fen");n==null||n.addEventListener("input",()=>{this.fenInput=n.value}),(a=this.root.querySelector("[data-action='start']"))==null||a.addEventListener("click",()=>{if(this.error="",this.mode==="classical")this.tryResult(this.api.createClassical());else{const o=this.seedInput.trim();if(o==="")this.tryResult(this.api.createAnarchy(-1));else{const c=Number(o);if(!Number.isInteger(c)||c<0){this.error="Seed must be a non-negative integer",this.render();return}this.tryResult(this.api.createAnarchy(c))}}}),(h=this.root.querySelector("[data-action='load-fen']"))==null||h.addEventListener("click",()=>{this.error="",this.tryResult(this.api.ofFen(this.fenInput.trim()))}),this.root.querySelectorAll("[data-sq]").forEach(o=>{o.addEventListener("click",()=>{const c=o.dataset.sq;c&&this.onSquareClick(c)})});const s=this.root.querySelector("[data-form='notation']");s==null||s.addEventListener("submit",o=>{o.preventDefault();const c=s.elements.namedItem("notation");this.notation=c.value;try{const f=C(this.api.applyNotation(this.notation.trim()));this.setGame(f),this.notation="",this.render()}catch(f){this.error=f instanceof Error?f.message:String(f),this.render()}}),(p=this.root.querySelector("[data-action='undo']"))==null||p.addEventListener("click",()=>{this.tryResult(this.api.undo())}),(u=this.root.querySelector("[data-action='resign']"))==null||u.addEventListener("click",()=>{this.tryResult(this.api.resign())}),(v=this.root.querySelector("[data-action='draw']"))==null||v.addEventListener("click",()=>{this.tryResult(this.api.offerDraw())}),(b=this.root.querySelector("[data-action='help']"))==null||b.addEventListener("click",()=>{this.helpOpen=!this.helpOpen,this.render()}),(g=this.root.querySelector("[data-action='new']"))==null||g.addEventListener("click",()=>{this.screen="landing",this.error="",this.helpOpen=!1,this.render()}),(y=this.root.querySelector("[data-action='copy-fen']"))==null||y.addEventListener("click",async()=>{if(this.game)try{await navigator.clipboard.writeText(this.game.fen)}catch{this.error="Could not copy FEN",this.render()}}),(w=this.root.querySelector("[data-action='cancel-promo']"))==null||w.addEventListener("click",()=>{this.pendingPromo=null,this.selected=null,this.render()}),this.root.querySelectorAll("[data-promo]").forEach(o=>{o.addEventListener("click",()=>{const c=o.dataset.promo;this.applyPromo(c)})})}}function d(t){return t.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function E(t){return d(t).replaceAll("'","&#39;")}const q=document.querySelector("#app");q&&new x(q).boot();
