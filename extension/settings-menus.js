// Themeable settings choices. Native selects remain the source of saved values.
(() => {
  const controls=[];
  let active=null;
  const close=()=>{if(!active)return;active.list.hidden=true;active.button.setAttribute('aria-expanded','false');active.button.removeAttribute('aria-activedescendant');active=null;};
  for(const select of document.querySelectorAll('#settings-form select, #dashboard-settings-form select')){
    const label=select.labels?.[0];
    const name=label?.textContent.split('\n')[0].replace(select.textContent,'').trim() || 'Setting';
    const button=document.createElement('button'),list=document.createElement('div');
    button.type='button';button.className='settings-choice';button.id=select.id+'-choice';
    button.setAttribute('role','combobox');button.setAttribute('aria-label',name);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    list.className='settings-options';list.id=select.id+'-options';list.hidden=true;list.setAttribute('role','listbox');list.setAttribute('aria-label',name);
    button.setAttribute('aria-controls',list.id);
    // Keep the overlay outside wrapping labels (label clicks must not reopen it).
    document.body.append(list);select.after(button);select.hidden=true;
    if(label){label.htmlFor=button.id;}
    const options=Array.from(select.options),rows=[];
    const control={button,list,refresh(){button.textContent=options[select.selectedIndex]?.textContent || '';rows.forEach((row,index)=>row.setAttribute('aria-selected',String(index===select.selectedIndex)));}};
    let cursor=0;
    function highlight(index){cursor=index;rows.forEach((row,i)=>row.classList.toggle('is-current',i===cursor));button.setAttribute('aria-activedescendant',rows[cursor].id);const row=rows[cursor];if(row.offsetTop<list.scrollTop)list.scrollTop=row.offsetTop;else if(row.offsetTop+row.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=row.offsetTop+row.offsetHeight-list.clientHeight;}
    function choose(index){select.value=options[index].value;select.dispatchEvent(new Event('change',{bubbles:true}));control.refresh();close();button.focus({preventScroll:true});}
    options.forEach((option,index)=>{
      const row=document.createElement('div');row.id=list.id+'-'+index;row.setAttribute('role','option');row.textContent=option.textContent;
      row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>choose(index));rows.push(row);list.append(row);
    });
    function open(){
      close();control.refresh();list.hidden=false;active=control;button.setAttribute('aria-expanded','true');highlight(select.selectedIndex);
      const rect=button.getBoundingClientRect(),pane=document.querySelector('main');
      const bottom=Math.min(innerHeight,pane?.getBoundingClientRect().bottom || innerHeight)-8;
      const top=Math.max(8,pane?.getBoundingClientRect().top || 0);
      const below=bottom-rect.bottom-5,above=rect.top-top-5;
      const up=below<Math.min(list.scrollHeight+2,200)&&above>below;
      const height=Math.min(list.scrollHeight+2,200,Math.max(0,up?above:below));
      Object.assign(list.style,{left:rect.left+'px',width:rect.width+'px',maxHeight:height+'px',top:(up?rect.top-height-5:rect.bottom+5)+'px'});highlight(select.selectedIndex);
    }
    button.addEventListener('click',()=>active===control?close():open());
    button.addEventListener('keydown',event=>{
      if(event.metaKey||event.ctrlKey||event.altKey||event.isComposing)return;
      if(event.key==='Tab'){close();return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        if(active!==control){open();return;}
        if(event.key==='Enter'||event.key===' '){choose(cursor);return;}
        highlight(event.key==='Home'?0:event.key==='End'?rows.length-1:(cursor+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length);
      }else if(event.key.length===1){
        event.preventDefault();event.stopPropagation();
        const index=options.findIndex(option=>option.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if(index>=0){if(active!==control)open();highlight(index);}
      }
    });
    select.addEventListener('change',control.refresh);control.refresh();controls.push(control);
  }
  document.addEventListener('pointerdown',event=>{if(active&&!active.button.contains(event.target)&&!active.list.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(active&&event.target!==active.button)close();});
  document.addEventListener('scroll',event=>{if(active&&event.target!==active.list)close();},true);
  window.addEventListener('resize',close);
  globalThis.TabbySettingsMenus={refresh(){controls.forEach(control=>control.refresh());}};
})();
