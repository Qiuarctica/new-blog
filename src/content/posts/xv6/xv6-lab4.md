---
title: xv6-lab4
published: 2025-01-06
description: xv6-lab4实验记录
tags: [C/C++,OS]
category: 实验记录
draft: false
---

## Backtrace (moderate)

在risc-v中，函数的帧栈被这样组织

![graphviz](/assets/xv6-lab4.svg)

我们可以通过不断获得fp(栈指针)从而遍历整个函数调用栈,  
我们可以默认函数调用的帧栈都被储存在一页上来设置终止条件：

```c
// printf.c
void backtrace() {
  uint64 s0;  // the stack frame pointer
  uint64 ra;  // the return address
  uint64 olds0;
  s0 = r_fp();
  olds0 = s0;
  printf("backtrace:\n");
  while (s0 >= PGROUNDDOWN(olds0) && s0 < PGROUNDUP(olds0)) {
    ra = *(uint64 *)(s0 - 8);
    printf("%p\n", (void *)ra);
    olds0 = s0;
    s0 = *(uint64 *)(s0 - 16);
  }
}
```

然后再在panic，sys_sleep等函数中加上backtrace的调用即可

## Alarm (hard)

> You should add a new sigalarm(interval, handler) system call. If an application calls sigalarm(n, fn), then after every n "ticks" of CPU time that the program consumes, the kernel should cause application function fn to be called. When fn returns, the application should resume where it left off. A tick is a fairly arbitrary unit of time in xv6, determined by how often a hardware timer generates interrupts. If an application calls sigalarm(0, 0), the kernel should stop generating periodic alarm calls.

我们需要为xv6添加一个简单的信号处理机制，用户在userspace向内核空间注册userspace的函数，并且希望每隔一段时间就执行用户注册的这些函数

难点主要在于如何在内核空间的处理程序中执行用户函数，首先在proc.h中为每个进程添加用于指示信号处理程序的字段

```c
// proc.h struct proc
  // sigaction handlers
  int alarm_interval;
  void (*sig_alarmsignal)(void);
  int last_alarm;
  struct trapframe tf; // save the previous trapframe
  int in_alarm_handler;
  ...
```

然后在sys_sigalarm中完成信号函数的注册

```c
// sysproc.c
uint64
sys_sigalarm(void){
int n;
uint64 handler;

argint(0, &n);
argaddr(1, &handler);

// printf("enter sys_sigalarm with args %d %p\n", n, (void*)handler);
struct proc *p = myproc();
p->alarm_interval = n;
p->sig_alarmsignal = (void (*)(void))handler;

return 0;
}
```

注册完成信号函数后，我们就要考虑怎么在内核空间中执行信息函数了.

每当xv6受到timer中断时，我们就将进程的内置计时器++，当计数到达设置阈值时，我们先保存当前的trapframe，然后在通过usertrapret返回到用户空间执行用户函数

```c
// trap.c
  ...
  if(which_dev == 2){
    p->last_alarm ++;
    if(p->in_alarm_handler){
      p->last_alarm = 0;
    } else if(p->last_alarm == p->alarm_interval){
      // 保存当前的trapframe
      p->tf = *p->trapframe;
      // 因为要执行用户态的函数，必须通过trap让程序在用户态下执行
      p->trapframe->epc = (uint64)p->sig_alarmsignal;
      p->last_alarm = 0;
      p->in_alarm_handler = 1;
      usertrapret();
    }
    yield();
  }
  ...
```

当用户的函数执行完后，其会调用系统调用sys_sigreturn,再次回到kernel space，此时我们便可以恢复上下文，继续执行先前的任务

```c
// sysproc.c

uint64 sys_sigreturn(void) {
  // 用户态函数执行完后，恢复之前程序中断时的上下文
  struct proc *p = myproc();
  *p->trapframe = p->tf;
  p->in_alarm_handler = 0;
  usertrapret();
  return 0;
}

```

## 总结

这次实验相比lab3就简单了许多，只需要摸清楚xv6的陷阱，中断等机制就可以做的非常顺畅.