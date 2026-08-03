var M=Object.defineProperty;var I=(t,e,r)=>e in t?M(t,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):t[e]=r;var c=(t,e,r)=>I(t,typeof e!="symbol"?e+"":e,r);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const n of i)if(n.type==="childList")for(const a of n.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&s(a)}).observe(document,{childList:!0,subtree:!0});function r(i){const n={};return i.integrity&&(n.integrity=i.integrity),i.referrerPolicy&&(n.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?n.credentials="include":i.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function s(i){if(i.ep)return;i.ep=!0;const n=r(i);fetch(i.href,n)}})();function N(){return window.Yacewo?Promise.resolve(window.Yacewo):new Promise((t,e)=>{const r=document.createElement("script");r.src="/yacewo/yacewo_engine.js",r.onload=()=>{window.Yacewo?t(window.Yacewo):e(new Error("Yacewo engine failed to export"))},r.onerror=()=>e(new Error("Failed to load yacewo_engine.js")),document.head.appendChild(r)})}function T(t){if(!t.ok||!t.game)throw new Error(t.error??"engine error");return t.game}const C="yacewo-theme";function x(){const t=localStorage.getItem(C);return t==="light"||t==="dark"?t:typeof window<"u"&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function R(t){localStorage.setItem(C,t)}function L(t){document.documentElement.dataset.theme=t}function B(t){return t==="light"?"dark":"light"}function D(t){return t==="light"?"Light":"Dark"}const F={"white-king":"♚","white-queen":"♛","white-rook":"♜","white-bishop":"♝","white-knight":"♞","white-pawn":"♟","black-king":"♚","black-queen":"♛","black-rook":"♜","black-bishop":"♝","black-knight":"♞","black-pawn":"♟"},Y={queen:"♛",rook:"♜",bishop:"♝",knight:"♞"};function w(t){const e=t%8+1,r=8-Math.floor(t/8),s=`${String.fromCharCode(96+e)}${r}`;return{file:e,rank:r,alg:s}}function H(t){const e=t.status;switch(e.tag){case"in_progress":return`${f(t.turn)} to move`;case"check":return`${f(e.color??t.turn)} in check — ${f(t.turn)} to move`;case"checkmate":return`${f(e.color==="white"?"black":"white")} wins by checkmate`;case"stalemate":return"Draw by stalemate";case"draw_insufficient":return"Draw by insufficient material";case"draw_agreement":return"Draw by agreement";case"resigned":return`${f(e.color==="white"?"black":"white")} wins — ${f(e.color??"")} resigned`;default:return e.tag}}function W(t){if(t.isOver)return null;const e=t.whiteDrawOffer,r=t.blackDrawOffer;return!e&&!r?null:e&&r?"Draw offered by both sides":e&&t.turn==="black"?"White offered a draw — accept or move":r&&t.turn==="white"?"Black offered a draw — accept or move":e&&t.turn==="white"?"White offered a draw — play your move":r&&t.turn==="black"?"Black offered a draw — play your move":null}function E(t){return t.isOver?!1:t.turn==="white"?t.blackDrawOffer:t.whiteDrawOffer}function f(t){return t&&t.charAt(0).toUpperCase()+t.slice(1)}function q(t){return t?F[`${t.color}-${t.kind}`]??"":""}class j{constructor(e){c(this,"api");c(this,"root");c(this,"screen","landing");c(this,"theme",x());c(this,"game",null);c(this,"mode","classical");c(this,"seedInput","");c(this,"fenInput","");c(this,"selected",null);c(this,"error","");c(this,"helpOpen",!1);c(this,"pendingPromo",null);c(this,"notation","");c(this,"previewBoard",[]);c(this,"anarchyPreviewSeed",null);c(this,"previewAnim",!1);c(this,"fenOpen",!1);this.root=e,L(this.theme)}async boot(){this.root.innerHTML='<div class="loading"><p>Loading YACEWO engine…</p></div>';try{this.api=await N(),this.refreshPreview(!1),this.render()}catch(e){this.root.innerHTML=`<div class="boot-error"><h1>Could not load engine</h1><p>${e instanceof Error?e.message:String(e)}</p></div>`}}refreshPreview(e){const r=this.mode==="classical"?this.api.createClassical():(()=>{const s=this.seedInput.trim();if(s!==""){const i=Number(s);return!Number.isInteger(i)||i<0?null:this.api.createAnarchy(i)}return this.anarchyPreviewSeed!=null?this.api.createAnarchy(this.anarchyPreviewSeed):this.api.createAnarchy(-1)})();!r||!r.ok||!r.game||(this.previewBoard=r.game.board,this.mode==="anarchy"&&r.game.seed!=null&&(this.anarchyPreviewSeed=r.game.seed),this.previewAnim=e)}rollAnarchySeed(){const e=this.api.createAnarchy(-1);if(!e.ok||!e.game||e.game.seed==null){this.error=e.error??"Could not roll seed";return}this.mode="anarchy",this.seedInput=String(e.game.seed),this.anarchyPreviewSeed=e.game.seed,this.previewBoard=e.game.board,this.previewAnim=!0,this.error=""}setGame(e){this.game=e,this.selected=null,this.error="",this.pendingPromo=null}tryResult(e,r="play"){if(!e.ok||!e.game){this.error=e.error??"Something went wrong",this.render();return}this.setGame(e.game),this.screen=r,this.render()}legalTargets(e){return this.game?this.game.legalMoves.filter(r=>r.kind==="normal"&&r.from===e):[]}castlesFrom(e){if(!this.game)return[];const s=this.game.turn==="white"?"e1":"e8";return e!==s?[]:this.game.legalMoves.filter(i=>i.kind==="castle")}onSquareClick(e){if(!this.game||this.game.isOver)return;const r=this.game.board.findIndex((i,n)=>w(n).alg===e),s=r>=0?this.game.board[r]:null;if(!this.selected){s&&s.color===this.game.turn&&(this.selected=e,this.error="",this.render());return}if(this.selected===e){this.selected=null,this.render();return}if(s&&s.color===this.game.turn){this.selected=e,this.render();return}this.attemptMove(this.selected,e)}attemptMove(e,r){if(!this.game)return;const s=this.castlesFrom(e);for(const a of s){const d=this.game.turn==="white"?"1":"8",p=a.side==="king"?`g${d}`:`c${d}`;if(r===p){this.tryResult(this.api.applyCastle(a.side));return}}const i=this.legalTargets(e).filter(a=>a.to===r);if(i.length===0){this.error="Illegal move",this.selected=null,this.render();return}const n=i.some(a=>a.promotion);if(n&&i.every(a=>a.promotion==="queen"),n){this.pendingPromo={from:e,to:r},this.render();return}this.tryResult(this.api.applyMove(e,r,null))}applyPromo(e){if(!this.pendingPromo)return;const{from:r,to:s}=this.pendingPromo;this.tryResult(this.api.applyMove(r,s,e))}renderTopbar(e){return`
      <header class="topbar">
        ${e?'<a class="brand-mark" href="#/" data-nav="landing">YACEWO</a>':'<div class="brand-mark">YACEWO</div>'}
        <button type="button" class="theme-btn" data-action="theme">${D(this.theme)}</button>
      </header>
    `}renderPreviewBoard(){const e=this.previewAnim?" is-settling":"",r=this.mode==="anarchy"?" preview-plate anarchy":" preview-plate",s=this.previewBoard.map((i,n)=>{const{file:a,rank:d}=w(n),p=(a+d)%2===1,h=q(i),m=this.previewAnim?` style="--i:${n};--wave-col:${a-1}"`:` style="--wave-col:${a-1}"`;return`<div class="sq ${p?"light":"dark"}${i?" has-piece":""}"${m}>${h?`<span class="piece ${(i==null?void 0:i.color)??""}">${h}</span>`:""}</div>`}).join("");return`
      <div class="landing-preview${e}">
        <div class="board-plate${r}" aria-hidden="true">
          <div class="board preview-board">${s}</div>
        </div>
        <div class="mode-toggle" role="tablist" aria-label="Game mode">
          <button type="button" role="tab" class="mode-link${this.mode==="classical"?" active":""}" data-mode="classical" aria-selected="${this.mode==="classical"}">Classical</button>
          <span class="mode-sep" aria-hidden="true">·</span>
          <button type="button" role="tab" class="mode-link${this.mode==="anarchy"?" active anarchy":""}" data-mode="anarchy" aria-selected="${this.mode==="anarchy"}">Anarchy</button>
        </div>
      </div>
    `}renderLanding(){return this.previewBoard.length===0&&this.refreshPreview(!1),`
      ${this.renderTopbar(!1)}
      <main class="landing">
        <div class="landing-wash" aria-hidden="true"></div>
        <div class="landing-frost" aria-hidden="true"></div>
        <section class="landing-hero">
          <h1>(Yet Another) Chess Engine Written in OCaml</h1>
        </section>
        ${this.renderPreviewBoard()}
        <section class="landing-cta">
          <button type="button" class="primary-btn play-btn" data-action="start">Play</button>
          ${this.error?`<div class="error-line">${u(this.error)}</div>`:""}
        </section>
        <section class="landing-fen">
          <button type="button" class="text-btn fen-toggle" data-action="toggle-fen" aria-expanded="${this.fenOpen}">
            ${this.fenOpen?"Hide position":"Load position"}
          </button>
          ${this.fenOpen?`<div class="fen-panel">
                  <label class="sr-only" for="fen">FEN</label>
                  <textarea id="fen" rows="2" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">${u(this.fenInput)}</textarea>
                  <button type="button" class="text-btn" data-action="load-fen">Load</button>
                </div>`:""}
        </section>
        ${this.mode==="anarchy"?`<section class="landing-seed">
                <div class="seed-ritual">
                  <label class="seed-inline" for="seed">Seed</label>
                  <input id="seed" inputmode="numeric" placeholder="random" value="${O(this.seedInput)}" />
                  <button type="button" class="text-btn seed-roll" data-action="roll-seed" aria-label="Shuffle" title="Shuffle">
                    <svg class="seed-roll-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2 4h3.2l5.6 8H14M14 4h-3.2L8.2 7.2M2 12h3.2l1.8-2.4M12.5 2.5 14 4l-1.5 1.5M12.5 10.5 14 12l-1.5 1.5"/>
                    </svg>
                  </button>
                </div>
              </section>`:""}
      </main>
    `}renderBoard(){if(!this.game)return"";const e=new Set;if(this.selected){for(const n of this.legalTargets(this.selected))e.add(n.to);for(const n of this.castlesFrom(this.selected)){const a=this.game.turn==="white"?"1":"8";e.add(n.side==="king"?`g${a}`:`c${a}`)}}const r=this.game.board.map((n,a)=>{const{file:d,rank:p,alg:h}=w(a),b=["sq",(d+p)%2===1?"light":"dark",this.selected===h?"selected":"",e.has(h)?"legal":"",n?"has-piece":""].filter(Boolean).join(" "),v=q(n);return`<button type="button" class="${b}" data-sq="${h}" aria-label="${h}" style="--wave-col:${d-1}">${v?`<span class="piece ${(n==null?void 0:n.color)??""}">${v}</span>`:""}</button>`}).join(""),s=[8,7,6,5,4,3,2,1].map(n=>`<span>${n}</span>`).join(""),i=["a","b","c","d","e","f","g","h"].map(n=>`<span>${n}</span>`).join("");return`
      <div class="board-plate">
        <div class="board-stage">
          <div class="rank-gutter" aria-hidden="true">${s}</div>
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
            ${["queen","rook","bishop","knight"].map(e=>`<button type="button" data-promo="${e}" aria-label="${e}">${Y[e]}</button>`).join("")}
          </div>
          <button type="button" class="ghost-btn" data-action="cancel-promo">Cancel</button>
        </div>
      </div>
    `:""}renderPlay(){if(!this.game)return this.renderLanding();const e=this.game,r=e.seed!=null?"status-meta anarchy":"status-meta",s=e.seed!=null?"Anarchy":"Classical",i=W(e),n=E(e)?"Accept draw":"Draw";return`
      ${this.renderTopbar(!0)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${u(H(e))}</span>
            <span class="${r}">${u(s)}</span>
          </div>
          ${i?`<div class="draw-offer" role="status">${u(i)}</div>`:""}
          ${this.renderBoard()}
          <form class="algebraic" data-form="notation">
            <input name="notation" placeholder="e4 · Nf3 · O-O" autocomplete="off" value="${O(this.notation)}" ${e.isOver?"disabled":""} />
            <button class="primary-btn" type="submit" ${e.isOver?"disabled":""}>Move</button>
          </form>
          <div class="error-line">${u(this.error)}</div>
        </section>
        <aside class="panel">
          <h2>Game</h2>
          <div class="panel-section">
            <div class="label">Moves</div>
            <div class="move-list">${u(e.moveList||"No moves yet.")}</div>
          </div>
          <div class="panel-section">
            <div class="label">FEN</div>
            <div class="fen-box">${u(e.fen)}</div>
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
    `}render(){this.root.innerHTML=this.screen==="landing"?this.renderLanding():this.renderPlay(),this.bind(),this.screen==="landing"&&this.previewAnim&&window.setTimeout(()=>{var e;this.previewAnim=!1,(e=this.root.querySelector(".landing-preview"))==null||e.classList.remove("is-settling")},700)}patchLandingPreview(){const e=this.root.querySelector(".landing-preview");if(!e)return;const r=document.createElement("div");r.innerHTML=this.renderPreviewBoard().trim();const s=r.firstElementChild;s&&e.replaceWith(s),this.previewAnim&&window.setTimeout(()=>{var i;this.previewAnim=!1,(i=this.root.querySelector(".landing-preview"))==null||i.classList.remove("is-settling")},700)}bindPieceWave(e){e.addEventListener("pointerover",r=>{const s=r.target;if(!(s instanceof Element))return;const i=s.closest(".sq");if(!i||!e.contains(i))return;const n=i.querySelector(".piece");if(!n)return;const a=n.classList.contains("white")?"white":n.classList.contains("black")?"black":null;if(!a)return;const d=`wave-${a}`;e.classList.contains(d)||(e.classList.remove("wave-white","wave-black"),e.offsetWidth,e.classList.add(d))}),e.addEventListener("pointerleave",()=>{e.classList.remove("wave-white","wave-black")})}bind(){var n,a,d,p,h,m,b,v,y,k,$,P,S;(n=this.root.querySelector("[data-action='theme']"))==null||n.addEventListener("click",()=>{this.theme=B(this.theme),R(this.theme),L(this.theme),this.render()}),(a=this.root.querySelector("[data-nav='landing']"))==null||a.addEventListener("click",l=>{l.preventDefault(),this.screen="landing",this.error="",this.refreshPreview(!0),this.render()}),this.root.querySelectorAll("[data-mode]").forEach(l=>{l.addEventListener("click",()=>{const o=l.dataset.mode==="anarchy"?"anarchy":"classical";o!==this.mode&&(this.mode=o,this.error="",this.refreshPreview(!0),this.render())})});const e=this.root.querySelector("#seed");e==null||e.addEventListener("input",()=>{this.seedInput=e.value;const l=this.seedInput.trim();if(l==="")return;const o=Number(l);!Number.isInteger(o)||o<0||(this.anarchyPreviewSeed=o,this.refreshPreview(!0),this.patchLandingPreview())}),(d=this.root.querySelector("[data-action='roll-seed']"))==null||d.addEventListener("click",()=>{this.rollAnarchySeed(),this.render()}),(p=this.root.querySelector("[data-action='toggle-fen']"))==null||p.addEventListener("click",()=>{this.fenOpen=!this.fenOpen,this.render()});const r=this.root.querySelector("#fen");r==null||r.addEventListener("input",()=>{this.fenInput=r.value}),(h=this.root.querySelector("[data-action='start']"))==null||h.addEventListener("click",()=>{if(this.error="",this.mode==="classical")this.tryResult(this.api.createClassical());else{const l=this.seedInput.trim();if(l===""){const o=this.anarchyPreviewSeed??-1;this.tryResult(this.api.createAnarchy(o))}else{const o=Number(l);if(!Number.isInteger(o)||o<0){this.error="Seed must be a non-negative integer",this.render();return}this.tryResult(this.api.createAnarchy(o))}}}),(m=this.root.querySelector("[data-action='load-fen']"))==null||m.addEventListener("click",()=>{this.error="",this.tryResult(this.api.ofFen(this.fenInput.trim()))}),this.root.querySelectorAll("[data-sq]").forEach(l=>{l.addEventListener("click",()=>{const o=l.dataset.sq;o&&this.onSquareClick(o)})});const s=this.root.querySelector(".preview-board");s&&this.bindPieceWave(s);const i=this.root.querySelector("[data-form='notation']");i==null||i.addEventListener("submit",l=>{l.preventDefault();const o=i.elements.namedItem("notation");this.notation=o.value;try{const g=T(this.api.applyNotation(this.notation.trim()));this.setGame(g),this.notation="",this.render()}catch(g){this.error=g instanceof Error?g.message:String(g),this.render()}}),(b=this.root.querySelector("[data-action='undo']"))==null||b.addEventListener("click",()=>{this.tryResult(this.api.undo())}),(v=this.root.querySelector("[data-action='resign']"))==null||v.addEventListener("click",()=>{this.tryResult(this.api.resign())}),(y=this.root.querySelector("[data-action='draw']"))==null||y.addEventListener("click",()=>{this.tryResult(this.api.offerDraw())}),(k=this.root.querySelector("[data-action='help']"))==null||k.addEventListener("click",()=>{this.helpOpen=!this.helpOpen,this.render()}),($=this.root.querySelector("[data-action='new']"))==null||$.addEventListener("click",()=>{this.screen="landing",this.error="",this.helpOpen=!1,this.refreshPreview(!0),this.render()}),(P=this.root.querySelector("[data-action='copy-fen']"))==null||P.addEventListener("click",async()=>{if(this.game)try{await navigator.clipboard.writeText(this.game.fen)}catch{this.error="Could not copy FEN",this.render()}}),(S=this.root.querySelector("[data-action='cancel-promo']"))==null||S.addEventListener("click",()=>{this.pendingPromo=null,this.selected=null,this.render()}),this.root.querySelectorAll("[data-promo]").forEach(l=>{l.addEventListener("click",()=>{const o=l.dataset.promo;this.applyPromo(o)})})}}function u(t){return t.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function O(t){return u(t).replaceAll("'","&#39;")}const A=document.querySelector("#app");A&&new j(A).boot();
