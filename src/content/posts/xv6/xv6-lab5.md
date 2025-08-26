---
title: xv6-lab5
published: 2025-01-07
description: xv6-lab5实验记录
tags: [C/C++,OS]
category: 实验记录
draft: false
---

COW(copy-on-write)写时复制，也成为懒复制，在系统领域有广泛的应用，我们在fork时子进程需要复制父进程的地址空间，但是往往子进程不会用到(或是只读)父进程的全部地址空间，如果完全复制下来便会造成许多浪费，我们的任务便是在XV6中实现cow功能

## Implement copy-on-write fork (Hard)

> Your task is to implement copy-on-write fork in the xv6 kernel. You are done if your modified kernel executes both the cowtest and 'usertests -q' programs successfully.

首先我们来分析该如何实现cow,当子进程想要复制父进程的地址空间时，我们可以选择并不为子进程分配新页，而只是复制子进程的页表，同时清除子进程和父进程对页面的写权限，此时，对页面的读操作可以正常执行(有读权限),在父/子进程想要修改页面时就会触发一个页错误，我们只需要在页错误中加入处理程序，为其重新分配一个页面即可.

大体思路有了，但是还有许多前提条件需要我们先实现.
首先我们需要添加一个PTE_COW标志来指定某一页是处于COW状态

```c
// riscv.h
#define PTE_COW (1L << 9) // copy on write
```

其次我们需要考虑，在普通情况下，一个页面只有一个进程所拥有，当两个进程同时拥有一个页面时，我们需要为页面添加引用次数机制(类似于shared_ptr)来放置一个进程释放了页面而另一个进程仍持有该页面的悬空地址

### 添加引用计数

为每个页面维护一个引用计数是需要大量空间的，首先我们需要在地址空间中开辟一段区域来维护每个页面的引用次数

```c
// kalloc.c
int * refcount;
int pages;

void
kinit()
{
  initlock(&kmem.lock, "kmem");
  // 计算出储存所有引用计数所需要的空间以及页数
  int refcount_size = (PHYSTOP - (uint64)end) / (PGSIZE / sizeof(int) + 1);
  pages = refcount_size / PGSIZE + 1;
  freerange(end, (void*)PHYSTOP);
}

void
freerange(void *pa_start, void *pa_end )
{
  char *p;
  p = (char*)PGROUNDUP((uint64)pa_start);
  // 为引用计数页分配空间
  refcount = (int*)p;
  p += (pages) * PGSIZE;
  memset(refcount, 0, pages * PGSIZE);
  for(; p + PGSIZE <= (char*)pa_end; p += PGSIZE)
    kfree(p);
}

```

然后我们便可以实现类似于shared_ptr的页面分配机制

```c
// kalloc.c
uint64 get_index(void *pa)
{
  return (uint64)(pa - (void *)end) / PGSIZE;
}

void
kfree(void *pa)
{
  int index = get_index(pa);
  if(refcount[index] > 1){
    refcount[index] -= 1;
    return;
  }
  ...
}

void *
kalloc(void)
{
  struct run *r;

  acquire(&kmem.lock);
  r = kmem.freelist;
  if(r)
    kmem.freelist = r->next;
  release(&kmem.lock);

  if(r){
    memset((char*)r, 5, PGSIZE); // fill with junk
    int index = get_index((void*)r);
    refcount[index] = 1;
  }

  return (void*)r;
}

void 
add_ref(void *pa)
{
  int index = get_index(pa);
  refcount[index] += 1;
}

```

### 实现COW

在搭建好基础设施之后，我们便可以开始着手实现COW了，首先是uvmcopy

```c
// vm.c
int
uvmcopy(pagetable_t old, pagetable_t new, uint64 sz)
{
  pte_t *pte;
  uint64 pa, i;
  uint flags;
  // char *mem;

  for(i = 0; i < sz; i += PGSIZE){
    if((pte = walk(old, i, 0)) == 0)
      panic("uvmcopy: pte should exist");
    if((*pte & PTE_V) == 0)
      panic("uvmcopy: page not present");
    pa = PTE2PA(*pte);
    add_ref((void*)pa);
    flags = PTE_FLAGS(*pte);
    // 写时复制
    if(flags & PTE_W || flags & PTE_COW){
    flags = (flags & ~PTE_W) | PTE_COW;
    *pte = (*pte & ~PTE_W) | PTE_COW;
    sfence_vma();
    }
    if(mappages(new, i, PGSIZE, (uint64)pa, flags) != 0){
      goto err;
    }
  }
  return 0;

 err:
  uvmunmap(new, 0, i / PGSIZE, 1);
  return -1;
}
```

然后我们只需要静静等候进程触发页错误

```c
// trap.c usertrap
...
if (r_scause() == 0xf)  // store page fault
  {
    uint64      va = r_stval();
    pagetable_t pt = p->pagetable;
    if (va >= MAXVA) {
      printf("usertrap(): va=%p\n", (void *)va);
      printf("            sepc=%p\n", (void *)r_sepc());
      setkilled(p);
      goto exit;
    }
    pte_t *pte = walk(pt, va, 0);
    if (!pte) {
      printf("usertrap(): pte is null\n");
      printf("            va=%p\n", (void *)va);
      printf("            sepc=%p\n", (void *)r_sepc());
      setkilled(p);
      goto exit;
    }
    if (*pte & PTE_COW && *pte & PTE_U && *pte & PTE_V) {  // copy on write
       // change to not cow
      *pte &= ~PTE_COW;                                   
        // change to writable
      *pte |= PTE_W;                                       
      uint64 pa = PTE2PA(*pte);
      int flags = PTE_FLAGS(*pte);
      char *mem = kalloc();
      if (mem == 0) {
        printf("usertrap(): out of memory\n");
        setkilled(p);
        return;
      }
      memmove(mem, (char *)pa, PGSIZE);
      *pte = PA2PTE((uint64)mem) | flags;
      kfree((void *)pa);
      sfence_vma();
    } else {
      printf("usertrap(): unexpected scause 0x%lx pid=%d\n", r_scause(),
             p->pid);
      printf("            sepc=0x%lx stval=0x%lx\n", r_sepc(), r_stval());
      setkilled(p);
    }
  }
  ...
exit:
  if (killed(p)) exit(-1);
  // give up the CPU if this is a timer interrupt.
  if (which_dev == 2) yield();
  usertrapret();
```

至此便实现了一个简单版的COW功能