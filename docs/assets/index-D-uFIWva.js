var L=Object.defineProperty;var P=(t,e,r)=>e in t?L(t,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):t[e]=r;var l=(t,e,r)=>P(t,typeof e!="symbol"?e+"":e,r);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))a(i);new MutationObserver(i=>{for(const n of i)if(n.type==="childList")for(const s of n.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&a(s)}).observe(document,{childList:!0,subtree:!0});function r(i){const n={};return i.integrity&&(n.integrity=i.integrity),i.referrerPolicy&&(n.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?n.credentials="include":i.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function a(i){if(i.ep)return;i.ep=!0;const n=r(i);fetch(i.href,n)}})();function C(){return window.Yacewo?Promise.resolve(window.Yacewo):new Promise((t,e)=>{const r=document.createElement("script");r.src="/yacewo/yacewo_engine.js",r.onload=()=>{window.Yacewo?t(window.Yacewo):e(new Error("Yacewo engine failed to export"))},r.onerror=()=>e(new Error("Failed to load yacewo_engine.js")),document.head.appendChild(r)})}function A(t){if(!t.ok||!t.game)throw new Error(t.error??"engine error");return t.game}const S="yacewo-theme";function N(){const t=localStorage.getItem(S);return t==="light"||t==="dark"?t:typeof window<"u"&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function R(t){localStorage.setItem(S,t)}function k(t){document.documentElement.dataset.theme=t}function T(t){return t==="light"?"dark":"light"}function D(t){return t==="light"?"Light":"Dark"}const I={"white-king":"♚","white-queen":"♛","white-rook":"♜","white-bishop":"♝","white-knight":"♞","white-pawn":"♟","black-king":"♚","black-queen":"♛","black-rook":"♜","black-bishop":"♝","black-knight":"♞","black-pawn":"♟"},M={queen:"♛",rook:"♜",bishop:"♝",knight:"♞"};function $(t){const e=t%8+1,r=8-Math.floor(t/8),a=`${String.fromCharCode(96+e)}${r}`;return{file:e,rank:r,alg:a}}function F(t){const e=t.status;switch(e.tag){case"in_progress":return`${m(t.turn)} to move`;case"check":return`${m(e.color??t.turn)} in check — ${m(t.turn)} to move`;case"checkmate":return`${m(e.color==="white"?"black":"white")} wins by checkmate`;case"stalemate":return"Draw by stalemate";case"draw_insufficient":return"Draw by insufficient material";case"draw_agreement":return"Draw by agreement";case"resigned":return`${m(e.color==="white"?"black":"white")} wins — ${m(e.color??"")} resigned`;default:return e.tag}}function Y(t){if(t.isOver)return null;const e=t.whiteDrawOffer,r=t.blackDrawOffer;return!e&&!r?null:e&&r?"Draw offered by both sides":e&&t.turn==="black"?"White offered a draw — accept or move":r&&t.turn==="white"?"Black offered a draw — accept or move":e&&t.turn==="white"?"White offered a draw — play your move":r&&t.turn==="black"?"Black offered a draw — play your move":null}function E(t){return t.isOver?!1:t.turn==="white"?t.blackDrawOffer:t.whiteDrawOffer}function m(t){return t&&t.charAt(0).toUpperCase()+t.slice(1)}function x(t){return t?I[`${t.color}-${t.kind}`]??"":""}class B{constructor(e){l(this,"api");l(this,"root");l(this,"screen","landing");l(this,"theme",N());l(this,"game",null);l(this,"mode","classical");l(this,"seedInput","");l(this,"fenInput","");l(this,"selected",null);l(this,"error","");l(this,"helpOpen",!1);l(this,"pendingPromo",null);l(this,"notation","");this.root=e,k(this.theme)}async boot(){this.root.innerHTML='<div class="loading"><p>Loading YACEWO engine…</p></div>';try{this.api=await C(),this.render()}catch(e){this.root.innerHTML=`<div class="boot-error"><h1>Could not load engine</h1><p>${e instanceof Error?e.message:String(e)}</p></div>`}}setGame(e){this.game=e,this.selected=null,this.error="",this.pendingPromo=null}tryResult(e,r="play"){if(!e.ok||!e.game){this.error=e.error??"Something went wrong",this.render();return}this.setGame(e.game),this.screen=r,this.render()}legalTargets(e){return this.game?this.game.legalMoves.filter(r=>r.kind==="normal"&&r.from===e):[]}castlesFrom(e){if(!this.game)return[];const a=this.game.turn==="white"?"e1":"e8";return e!==a?[]:this.game.legalMoves.filter(i=>i.kind==="castle")}onSquareClick(e){if(!this.game||this.game.isOver)return;const r=this.game.board.findIndex((i,n)=>$(n).alg===e),a=r>=0?this.game.board[r]:null;if(!this.selected){a&&a.color===this.game.turn&&(this.selected=e,this.error="",this.render());return}if(this.selected===e){this.selected=null,this.render();return}if(a&&a.color===this.game.turn){this.selected=e,this.render();return}this.attemptMove(this.selected,e)}attemptMove(e,r){if(!this.game)return;const a=this.castlesFrom(e);for(const s of a){const h=this.game.turn==="white"?"1":"8",p=s.side==="king"?`g${h}`:`c${h}`;if(r===p){this.tryResult(this.api.applyCastle(s.side));return}}const i=this.legalTargets(e).filter(s=>s.to===r);if(i.length===0){this.error="Illegal move",this.selected=null,this.render();return}const n=i.some(s=>s.promotion);if(n&&i.every(s=>s.promotion==="queen"),n){this.pendingPromo={from:e,to:r},this.render();return}this.tryResult(this.api.applyMove(e,r,null))}applyPromo(e){if(!this.pendingPromo)return;const{from:r,to:a}=this.pendingPromo;this.tryResult(this.api.applyMove(r,a,e))}renderTopbar(e){return`
      <header class="topbar">
        ${e?'<a class="brand-mark" href="#/" data-nav="landing">YACEWO</a>':'<div class="brand-mark">YACEWO</div>'}
        <button type="button" class="theme-btn" data-action="theme">${D(this.theme)}</button>
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
                  <input id="seed" inputmode="numeric" placeholder="42" value="${q(this.seedInput)}" />
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
    `}renderBoard(){if(!this.game)return"";const e=new Set;if(this.selected){for(const n of this.legalTargets(this.selected))e.add(n.to);for(const n of this.castlesFrom(this.selected)){const s=this.game.turn==="white"?"1":"8";e.add(n.side==="king"?`g${s}`:`c${s}`)}}const r=this.game.board.map((n,s)=>{const{file:h,rank:p,alg:u}=$(s),g=["sq",(h+p)%2===1?"light":"dark",this.selected===u?"selected":"",e.has(u)?"legal":"",n?"has-piece":""].filter(Boolean).join(" "),f=x(n);return`<button type="button" class="${g}" data-sq="${u}" aria-label="${u}">${f?`<span class="piece ${(n==null?void 0:n.color)??""}">${f}</span>`:""}</button>`}).join(""),a=[8,7,6,5,4,3,2,1].map(n=>`<span>${n}</span>`).join(""),i=["a","b","c","d","e","f","g","h"].map(n=>`<span>${n}</span>`).join("");return`
      <div class="board-plate">
        <div class="board-stage">
          <div class="rank-gutter" aria-hidden="true">${a}</div>
          <div class="board" role="grid" aria-label="Chess board">${r}</div>
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
    `:""}renderPlay(){if(!this.game)return this.renderLanding();const e=this.game,r=e.seed!=null?"status-meta anarchy":"status-meta",a=e.seed!=null?"Anarchy":"Classical",i=Y(e),n=E(e)?"Accept draw":"Draw";return`
      ${this.renderTopbar(!0)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${d(F(e))}</span>
            <span class="${r}">${d(a)}</span>
          </div>
          ${i?`<div class="draw-offer" role="status">${d(i)}</div>`:""}
          ${this.renderBoard()}
          <form class="algebraic" data-form="notation">
            <input name="notation" placeholder="e4 · Nf3 · O-O" autocomplete="off" value="${q(this.notation)}" ${e.isOver?"disabled":""} />
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
            <button type="button" class="action-btn${E(e)?" draw-accept":""}" data-action="draw" ${e.isOver?"disabled":""}>${n}</button>
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
    `}render(){this.root.innerHTML=this.screen==="landing"?this.renderLanding():this.renderPlay(),this.bind()}bind(){var i,n,s,h,p,u,v,g,f,y,w;(i=this.root.querySelector("[data-action='theme']"))==null||i.addEventListener("click",()=>{this.theme=T(this.theme),R(this.theme),k(this.theme),this.render()}),(n=this.root.querySelector("[data-nav='landing']"))==null||n.addEventListener("click",o=>{o.preventDefault(),this.screen="landing",this.error="",this.render()}),this.root.querySelectorAll("[data-mode]").forEach(o=>{o.addEventListener("click",()=>{this.mode=o.dataset.mode==="anarchy"?"anarchy":"classical",this.error="",this.render()})});const e=this.root.querySelector("#seed");e==null||e.addEventListener("input",()=>{this.seedInput=e.value});const r=this.root.querySelector("#fen");r==null||r.addEventListener("input",()=>{this.fenInput=r.value}),(s=this.root.querySelector("[data-action='start']"))==null||s.addEventListener("click",()=>{if(this.error="",this.mode==="classical")this.tryResult(this.api.createClassical());else{const o=this.seedInput.trim();if(o==="")this.tryResult(this.api.createAnarchy(-1));else{const c=Number(o);if(!Number.isInteger(c)||c<0){this.error="Seed must be a non-negative integer",this.render();return}this.tryResult(this.api.createAnarchy(c))}}}),(h=this.root.querySelector("[data-action='load-fen']"))==null||h.addEventListener("click",()=>{this.error="",this.tryResult(this.api.ofFen(this.fenInput.trim()))}),this.root.querySelectorAll("[data-sq]").forEach(o=>{o.addEventListener("click",()=>{const c=o.dataset.sq;c&&this.onSquareClick(c)})});const a=this.root.querySelector("[data-form='notation']");a==null||a.addEventListener("submit",o=>{o.preventDefault();const c=a.elements.namedItem("notation");this.notation=c.value;try{const b=A(this.api.applyNotation(this.notation.trim()));this.setGame(b),this.notation="",this.render()}catch(b){this.error=b instanceof Error?b.message:String(b),this.render()}}),(p=this.root.querySelector("[data-action='undo']"))==null||p.addEventListener("click",()=>{this.tryResult(this.api.undo())}),(u=this.root.querySelector("[data-action='resign']"))==null||u.addEventListener("click",()=>{this.tryResult(this.api.resign())}),(v=this.root.querySelector("[data-action='draw']"))==null||v.addEventListener("click",()=>{this.tryResult(this.api.offerDraw())}),(g=this.root.querySelector("[data-action='help']"))==null||g.addEventListener("click",()=>{this.helpOpen=!this.helpOpen,this.render()}),(f=this.root.querySelector("[data-action='new']"))==null||f.addEventListener("click",()=>{this.screen="landing",this.error="",this.helpOpen=!1,this.render()}),(y=this.root.querySelector("[data-action='copy-fen']"))==null||y.addEventListener("click",async()=>{if(this.game)try{await navigator.clipboard.writeText(this.game.fen)}catch{this.error="Could not copy FEN",this.render()}}),(w=this.root.querySelector("[data-action='cancel-promo']"))==null||w.addEventListener("click",()=>{this.pendingPromo=null,this.selected=null,this.render()}),this.root.querySelectorAll("[data-promo]").forEach(o=>{o.addEventListener("click",()=>{const c=o.dataset.promo;this.applyPromo(c)})})}}function d(t){return t.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function q(t){return d(t).replaceAll("'","&#39;")}const O=document.querySelector("#app");O&&new B(O).boot();
