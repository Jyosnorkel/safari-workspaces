// Sidebar routes swap views without reloading or discarding in-progress edits.
(() => {
  const pages=Array.from(document.querySelectorAll('[data-page]'));
  if(!pages.length)return;
  const links=Array.from(document.querySelectorAll('[data-page-link]'));
  const aliases={'':'home',home:'home','current-tabs':'home',organise:'organise',organize:'organise',ai:'organise',snapshots:'snapshots',saved:'snapshots',settings:'settings','dashboard-settings':'settings'};
  function show(request,{updateHash=true}={}){
    const page=aliases[request] || 'home';
    for(const section of pages)section.hidden=section.dataset.page!==page;
    for(const link of links){
      if(link.dataset.pageLink===page)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if(updateHash && location.hash!==`#${page}`)location.hash=page;
    document.title=`${page[0].toUpperCase()+page.slice(1)} — Tabby`;
    window.scrollTo({top:0,left:0,behavior:'instant'});
  }
  globalThis.DashboardPages={show};
  for(const link of links)link.addEventListener('click',event=>{event.preventDefault();show(link.dataset.pageLink);});
  globalThis.addEventListener('hashchange',()=>show(location.hash.slice(1),{updateHash:false}));
  show(location.hash.slice(1),{updateHash:false});
})();
