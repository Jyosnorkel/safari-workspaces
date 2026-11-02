// Local row selection; never changes tab inclusion or browser state by itself.
(() => {
  function create({announce=()=>{}}={}) {
    let ids=[], anchor=null;
    const selected=new Set(),bindings=new Map();
    const paint=()=>{
      for(const [id,rows] of bindings)for(const row of rows){row.classList.toggle('is-tab-selected',selected.has(id));row.setAttribute('aria-pressed',String(selected.has(id)));}
    };
    const report=()=>{paint();announce(selected.size,clear);};
    function clear(){selected.clear();anchor=null;report();}
    function setItems(next){ids=Array.from(next);const allowed=new Set(ids);for(const id of selected)if(!allowed.has(id))selected.delete(id);for(const id of bindings.keys())if(!allowed.has(id))bindings.delete(id);if(!allowed.has(anchor))anchor=null;paint();}
    function select(id,event={}){
      if(!ids.includes(id))return;
      if(event.shiftKey && ids.includes(anchor)){
        if(!event.metaKey&&!event.ctrlKey)selected.clear();
        const a=ids.indexOf(anchor),b=ids.indexOf(id);for(const item of ids.slice(Math.min(a,b),Math.max(a,b)+1))selected.add(item);
      }else if(event.metaKey||event.ctrlKey){if(selected.has(id))selected.delete(id);else selected.add(id);anchor=id;}
      else {selected.clear();selected.add(id);anchor=id;}
      report();
    }
    function bind(row,id,activate){
      if(!bindings.has(id))bindings.set(id,new Set());bindings.get(id).add(row);
      row.setAttribute('tabindex','0');row.setAttribute('role','button');row.setAttribute('aria-pressed',String(selected.has(id)));
      const interactive=event=>event.target && event.target!==row && ['INPUT','SELECT','BUTTON','OPTION','TEXTAREA','A'].includes(String(event.target.tagName).toUpperCase());
      row.addEventListener('click',(event={})=>{if(interactive(event))return;select(id,event);});
      row.addEventListener('dblclick',(event={})=>{if(interactive(event)||event.metaKey||event.ctrlKey||event.shiftKey)return;event.preventDefault?.();return activate();});
      row.addEventListener('keydown',event=>{
        if(interactive(event)||event.isComposing)return;
        if(event.key==='Escape'){event.preventDefault();clear();}
        else if(event.key==='Enter'){event.preventDefault();return activate();}
        else if(event.key===' '){event.preventDefault();select(id,event);}
      });
      paint();
    }
    return {setItems,bind,select,clear,has:id=>selected.has(id),values:()=>ids.filter(id=>selected.has(id)),beginRender(){bindings.clear();},dragIds(id){if(!selected.has(id))select(id);return ids.filter(item=>selected.has(item));}};
  }
  function toolbar(target,count,clear){
    if(!target)return;target.textContent='';
    const bar=document.createElement('div');bar.className='tab-selection-bar';
    const label=document.createElement('span');label.className='tab-selection-count';label.textContent=count?`${count} tab${count===1?'':'s'} selected`:'Selection cleared.';
    bar.title='Click to select · ⌘/Shift for multiple · Double-click or Enter to open';
    bar.append(label);
    if(count){const button=document.createElement('button');button.type='button';button.className='tab-selection-clear';button.textContent='Clear selection';button.addEventListener('click',clear);bar.append(button);}
    target.append(bar);
  }
  globalThis.TabbySelection={create,toolbar};
})();
