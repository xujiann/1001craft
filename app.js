"use strict";
(function () {
  const DATA = window.BEER_DATA || [];
  document.documentElement.classList.add("js");   // 标记 JS 可用：骨架/淡入等增强只在此时启用

  // 风格家族元数据：label(zh/en), color var, 代表 emoji
  const CATS = {
    lager:     { zh:"拉格·皮尔森", en:"Lager & Pils",   color:"var(--c-lager)",     emoji:"🍺" },
    pale:      { zh:"淡色艾尔",     en:"Pale Ale",        color:"var(--c-pale)",      emoji:"🍺" },
    ipa:       { zh:"IPA",          en:"IPA",             color:"var(--c-ipa)",       emoji:"🌿" },
    wheat:     { zh:"小麦啤酒",     en:"Wheat Beer",      color:"var(--c-wheat)",     emoji:"🌾" },
    belgian:   { zh:"比利时艾尔",   en:"Belgian Ale",     color:"var(--c-belgian)",   emoji:"⛪" },
    stout:     { zh:"世涛·波特",   en:"Stout & Porter",  color:"var(--c-stout)",     emoji:"🖤" },
    sour:      { zh:"酸啤·野啤",   en:"Sour & Wild",     color:"var(--c-sour)",      emoji:"🍋" },
    amber:     { zh:"琥珀·棕色",   en:"Amber & Brown",   color:"var(--c-amber)",     emoji:"🍺" },
    strong:    { zh:"烈性·桶陈",   en:"Strong & BA",     color:"var(--c-strong)",    emoji:"🔥" },
    specialty: { zh:"特色·季节",   en:"Specialty",       color:"var(--c-specialty)", emoji:"✨" },
  };
  const CAT_ORDER = ["lager","pale","ipa","wheat","belgian","stout","sour","amber","strong","specialty"];

  // 图片来源署名（CC 许可要求）
  const SOURCE_LABEL = { off:"Open Food Facts", wiki:"Wikipedia", commons:"Wikimedia Commons" };

  // 每个家族的 emoji 池，卡片略作变化
  const EMOJI = {
    lager:["🍺","🍻"], pale:["🍺","🍻"], ipa:["🌿","🍺"], wheat:["🌾","🍺"],
    belgian:["⛪","🍺"], stout:["🖤","🍺"], sour:["🍋","🍒"], amber:["🍺","🍁"],
    strong:["🔥","🥃"], specialty:["✨","🎃"],
  };
  function emojiFor(b){ const p = EMOJI[b.cat]||["🍺"]; return p[b.id % p.length]; }

  const abvNum = b => parseFloat(String(b.abv).replace(/[^0-9.]/g,"")) || 0;

  // ---- i18n ----
  const I18N = {
    zh:{ sub:"种精酿", subtitle:"从皮尔森的金黄到帝国世涛的深邃", beers:"款", styles:"风格",
         search:"搜索名称、酒厂、风格…", allOrigin:"全部产地", all:"全部",
         sortDefault:"默认", sortName:"按名称", sortAbv:"按酒精度", sortBrewery:"按酒厂", random:"随机一杯",
         noresults:"未找到符合条件的精酿", reset:"重置筛选",
         lStyle:"风格", lAbv:"酒精度", lOrigin:"产地", photo:"图片",
         prev:"← 上一款", next:"下一款 →",
         footer:"按常规风格分类，精选世界上的精酿啤酒 · 建设中 · 酒标图片来自 Open Food Facts、Wikipedia 与 Wikimedia Commons", langbtn:"EN" },
    en:{ sub:" Craft Beers", subtitle:"From golden Pilsner to the depths of Imperial Stout", beers:"beers", styles:"styles",
         search:"Search name, brewery, style…", allOrigin:"All origins", all:"All",
         sortDefault:"Default", sortName:"By name", sortAbv:"By ABV", sortBrewery:"By brewery", random:"Random pour",
         noresults:"No beers match your filters", reset:"Reset filters",
         lStyle:"Style", lAbv:"ABV", lOrigin:"Origin", photo:"Photo",
         prev:"← Prev", next:"Next →",
         footer:"A curated gallery of the world's craft beers, organized by style · in progress · Label photos from Open Food Facts, Wikipedia & Wikimedia Commons", langbtn:"中" },
  };
  let lang = localStorage.getItem("craft-lang") || "zh";

  // ---- state ----
  let activeCat = "";     // "" = 全部
  let originFilter = "";
  let sort = "default";
  let query = "";
  let filtered = [];
  let firstPaint = true;   // 仅首屏做错落入场动画
  let IMG = {};           // _images.json 清单：{id:{ok:true,...}}
  const hasImg = id => IMG[id] && IMG[id].ok;

  // ---- elements ----
  const $ = id => document.getElementById(id);
  const gallery = $("gallery"), catTabs = $("cat-tabs"), originSel = $("origin-filter"),
        sortSel = $("sort-filter"), searchIn = $("search"), clearBtn = $("clear-search"),
        noResults = $("no-results");

  function nameOf(b){ return lang==="zh" ? b.name : b.name_en; }
  function subOf(b){ return lang==="zh" ? b.name_en : b.name; }
  function breweryOf(b){ return lang==="zh" ? b.brewery : b.brewery_en; }
  function styleOf(b){ return lang==="zh" ? b.style : b.style_en; }
  function originOf(b){ return lang==="zh" ? b.origin : b.origin_en; }
  function descOf(b){ return lang==="zh" ? b.desc : b.desc_en; }

  // ---- 产地下拉 ----
  function buildOrigins(){
    const origins = [...new Set(DATA.map(originOf))].sort((a,b)=>a.localeCompare(b));
    const cur = originFilter;
    originSel.innerHTML = `<option value="">${I18N[lang].allOrigin}</option>` +
      origins.map(o=>`<option value="${o}">${o}</option>`).join("");
    originSel.value = cur;
  }

  // ---- 风格家族标签 ----
  function buildTabs(){
    const counts = {}; DATA.forEach(b=>counts[b.cat]=(counts[b.cat]||0)+1);
    let html = `<button class="cat-tab ${activeCat===""?"active":""}" data-cat="" style="--tabc:var(--accent)">`+
               `<span class="dot"></span>${I18N[lang].all} <span class="cnt">${DATA.length}</span></button>`;
    html += CAT_ORDER.filter(c=>counts[c]).map(c=>{
      const m=CATS[c];
      return `<button class="cat-tab ${activeCat===c?"active":""}" data-cat="${c}" style="--tabc:${m.color}">`+
             `<span class="dot"></span>${lang==="zh"?m.zh:m.en} <span class="cnt">${counts[c]}</span></button>`;
    }).join("");
    catTabs.innerHTML = html;
    catTabs.querySelectorAll(".cat-tab").forEach(t=>t.onclick=()=>{
      activeCat=t.dataset.cat; buildTabs(); apply();
    });
  }

  // ---- 筛选 ----
  function apply(){
    const q = query.trim().toLowerCase();
    filtered = DATA.filter(b=>{
      if(activeCat && b.cat!==activeCat) return false;
      if(originFilter && originOf(b)!==originFilter) return false;
      if(q){
        const hay = `${b.name} ${b.name_en} ${b.brewery} ${b.brewery_en} ${b.style} ${b.style_en} ${b.origin} ${b.origin_en}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });
    if(sort==="name") filtered.sort((a,b)=>nameOf(a).localeCompare(nameOf(b),lang==="zh"?"zh":"en"));
    else if(sort==="abv") filtered.sort((a,b)=>abvNum(b)-abvNum(a));
    else if(sort==="brewery") filtered.sort((a,b)=>breweryOf(a).localeCompare(breweryOf(b),lang==="zh"?"zh":"en"));
    else filtered.sort((a,b)=>a.id-b.id);
    render();
  }

  function render(){
    if(!filtered.length){ gallery.innerHTML=""; noResults.style.display="block"; }
    else{
      noResults.style.display="none";
      const first = firstPaint; firstPaint = false;
      gallery.innerHTML = filtered.map((b,i)=>{
        const m=CATS[b.cat];
        const has = hasImg(b.id);
        const inner = has
          ? `<img class="card-photo" src="images/${b.id}.jpg" alt="" loading="lazy" decoding="async">`
          : `<span class="card-emoji">${emojiFor(b)}</span>`;
        // 首屏错落入场：仅首次渲染加 .rise，延迟按序递增并封顶，避免搜索/筛选时闪烁
        const rise = first ? " rise" : "";
        const delay = first ? `;--d:${(Math.min(i,26)*0.03).toFixed(2)}s` : "";
        return `<article class="card${rise}" data-id="${b.id}" style="--cardc:${m.color}${delay}">`+
          `<div class="card-img ${has?"has-photo":"ph"}">`+
          `<span class="card-cat">${lang==="zh"?m.zh:m.en}</span>`+
          `<span class="card-abv">${b.abv}</span>`+
          `${inner}</div>`+
          `<div class="card-body">`+
            `<div class="card-name">${nameOf(b)}</div>`+
            `<div class="card-en">${subOf(b)}</div>`+
            `<div class="card-brewery">${breweryOf(b)}</div>`+
            `<div class="card-meta"><span>${styleOf(b)}</span><span>${originOf(b)}</span></div>`+
          `</div></article>`;
      }).join("");
      gallery.querySelectorAll(".card").forEach(c=>c.onclick=()=>openModal(+c.dataset.id));
      // 图片就绪后移除骨架、淡入（error 也移除，避免卡在微光态）
      gallery.querySelectorAll(".card-img.has-photo").forEach(box=>{
        const img=box.querySelector(".card-photo");
        const done=()=>box.classList.add("loaded");
        if(img.complete) done();   // 已在缓存/已就绪（含错误）直接揭示，避免卡在骨架
        else { img.addEventListener("load",done,{once:true}); img.addEventListener("error",done,{once:true}); }
      });
    }
    $("shown-count").textContent = filtered.length;
    $("style-count").textContent = new Set(DATA.map(b=>b.style_en)).size;
  }

  // ---- modal ----
  let modalId = null;
  function openModal(id){
    const b = DATA.find(x=>x.id===id); if(!b) return;
    modalId = id; const m=CATS[b.cat];
    const box = document.querySelector(".modal-box");
    box.style.setProperty("--cardc", m.color);
    if(hasImg(b.id)){ $("modal-img").innerHTML = `<img src="images/${b.id}.jpg" alt="${nameOf(b)}">`; }
    else { $("modal-img").innerHTML=""; $("modal-img").textContent = emojiFor(b); }
    $("modal-cat").textContent = lang==="zh"?m.zh:m.en;
    $("modal-name").textContent = nameOf(b);
    $("modal-en").textContent = subOf(b);
    $("modal-brewery").textContent = breweryOf(b);
    $("modal-desc").textContent = descOf(b);
    $("modal-style").textContent = styleOf(b);
    $("modal-abv").textContent = b.abv;
    $("modal-origin").textContent = originOf(b);
    // 图片来源署名（CC 许可要求；无图或无来源则隐藏）
    const cred = $("modal-credit"), info = IMG[b.id];
    if (hasImg(b.id) && info && info.src) {
      const label = SOURCE_LABEL[info.source] || info.source || "";
      cred.innerHTML = `${I18N[lang].photo}: <a href="${info.src}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      cred.style.display = "";
    } else {
      cred.style.display = "none"; cred.innerHTML = "";
    }
    const idx = filtered.findIndex(x=>x.id===id);
    $("modal-num").textContent = idx>=0 ? `${idx+1} / ${filtered.length}` : "";
    $("modal").classList.add("open");
  }
  function closeModal(){ $("modal").classList.remove("open"); modalId=null; }
  function step(d){
    const idx = filtered.findIndex(x=>x.id===modalId);
    if(idx<0) return;
    const n = (idx+d+filtered.length)%filtered.length;
    openModal(filtered[n].id);
  }

  // ---- 语言 ----
  function applyLang(){
    const t = I18N[lang];
    document.documentElement.lang = lang==="zh"?"zh-CN":"en";
    $("t-sub").textContent = t.sub;
    $("t-subtitle").textContent = t.subtitle;
    $("t-beers").textContent = t.beers;
    $("t-styles").textContent = t.styles;
    searchIn.placeholder = t.search;
    sortSel.options[0].text=t.sortDefault; sortSel.options[1].text=t.sortName;
    sortSel.options[2].text=t.sortAbv; sortSel.options[3].text=t.sortBrewery;
    $("random-btn").textContent = t.random;
    $("t-noresults").textContent = t.noresults;
    $("reset-btn").textContent = t.reset;
    $("l-style").textContent=t.lStyle; $("l-abv").textContent=t.lAbv; $("l-origin").textContent=t.lOrigin;
    $("prev-beer").textContent=t.prev; $("next-beer").textContent=t.next;
    $("t-footer").textContent=t.footer;
    $("lang-toggle").textContent=t.langbtn;
    buildOrigins(); buildTabs(); apply();
  }

  // ---- events ----
  searchIn.addEventListener("input",()=>{ query=searchIn.value; clearBtn.style.display=query?"block":"none"; apply(); });
  clearBtn.onclick=()=>{ searchIn.value=""; query=""; clearBtn.style.display="none"; apply(); };
  originSel.onchange=()=>{ originFilter=originSel.value; apply(); };
  sortSel.onchange=()=>{ sort=sortSel.value; apply(); };
  $("random-btn").onclick=()=>{ if(filtered.length) openModal(filtered[Math.floor(Math.random()*filtered.length)].id); };
  $("modal-close").onclick=closeModal;
  $("modal").onclick=e=>{ if(e.target===$("modal")) closeModal(); };
  $("prev-beer").onclick=()=>step(-1);
  $("next-beer").onclick=()=>step(1);
  $("reset-btn").onclick=()=>{ activeCat="";originFilter="";query="";searchIn.value="";clearBtn.style.display="none";buildTabs();buildOrigins();apply(); };
  $("lang-toggle").onclick=()=>{ lang=lang==="zh"?"en":"zh"; localStorage.setItem("craft-lang",lang); applyLang(); };
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape") closeModal();
    else if($("modal").classList.contains("open")){ if(e.key==="ArrowLeft")step(-1); if(e.key==="ArrowRight")step(1); }
    else if(e.key==="/"&&document.activeElement!==searchIn){ e.preventDefault(); searchIn.focus(); }
    else if(e.key.toLowerCase()==="r"&&document.activeElement!==searchIn){ $("random-btn").click(); }
  });

  // ---- init ----
  fetch("_images.json").then(r=>r.ok?r.json():{}).then(m=>{IMG=m||{};}).catch(()=>{}).finally(applyLang);
})();
