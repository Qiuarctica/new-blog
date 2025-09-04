---
title: 如何使用C++20实现一个超高效的SPSC队列
published: 2025-08-15
description: 基于C++20的高效SPSC队列实现与分析
tags: [C/C++,并发编程,性能优化]
category: C++
image: "../../../assets/maomi.jpg"
draft: false
---

在某量化公司实习时需要进行一些对高频交易系统的多线程优化，其中大量需要使用单生产者单消费者（SPSC）队列进行线程间的通信。最开始找到的是raomeng的[SPSC_Queue](https://github.com/MengRao/SPSC_Queue),但是实际测试下来性能仍然不是很理想，于是决定自己动手实现一个，遂有了本篇博客。

## SPSC队列简介

虽然我感觉SPSC队列以及是并发编程领域老生长谈的问题了，但是在这里还是简单的介绍一下。在多线程编程中，几乎90%的场景都可以被归类为[生产者-消费者问题](https://en.wikipedia.org/wiki/Producer%E2%80%93consumer_problem)，而SPSC队列则是生产者-消费者问题的一个特例，即只有一个生产者线程和一个消费者线程。我们可以针对这个性质做出特定的优化，从而达到超高性能。
## 队列设计

### 结构设计


在设计上，我们采用了典型的环形缓冲区结构，使用两个状态`ProducerState`和`ConsumerState`来分别跟踪生产者和消费者的状态。

```cpp
template <typename T, size_t Capacity> 
class SPSCQueue{
    ...
  struct alignas(CacheLineSize) ProducerState {
    std::atomic<size_t> head{0};
    size_t cached_tail{0};
    char padding[CacheLineSize - sizeof(std::atomic<size_t>) - sizeof(size_t)];
  };

  struct alignas(CacheLineSize) ConsumerState {
    std::atomic<size_t> tail{0};
    size_t cached_head{0};
    char padding[CacheLineSize - sizeof(std::atomic<size_t>) - sizeof(size_t)];
  };

  ProducerState prod_;
  ConsumerState cons_;
  std::array<T, Capacity> buffer_;
  ...
}
```

其中`head`和`tail`分别表示生产者和消费者的当前位置，`cached_tail`和`cached_head`则是各自缓存的对方位置，用于减少对共享原子变量的访问(后续会进行讨论)，从而降低缓存一致性开销。为了避免伪共享(False Sharing)，我们使用了`alignas(CacheLineSize)`来确保每个状态结构体独占一个缓存行。

> 关于**伪共享**问题，已有很多优秀的文章进行过介绍，推荐阅读[cache_coherence](https://diveintosystems.org/book/C14-SharedMemory/cache_coherence.html)。可以简单理解为当一个CPU核心修改某个缓存行时，由于缓存一致性协议的存在，其他核心中该缓存行的副本会被标记为无效，从而导致频繁的缓存行失效和内存访问，严重影响性能。而当我们把生产者和消费者状态分成两个缓存行时，由于生产者线程(核心)大部分情况下不会访问消费者线程(核心)的状态，反之亦然，不会频繁发生缓存行失效的情况，便避免了**伪共享**问题。

### 接口设计

现有的许多实现均采用了`push(const T & data)`之类的接口设计，会产生一次不必要的拷贝开销，而`emplace`接口虽然可以避免拷贝，但是通过传参构造的方式可用性不高，并且任然有构造开销。为此，我们选择了采用原地算法，通过用户传入的lambda来对数据进行构造，从而最大化性能。

```cpp
template <typename W, typename T>
concept Writer =
    std::invocable<W, T *> && std::is_void_v<std::invoke_result_t<W, T *>>;

template <typename R, typename T>
concept Reader = std::invocable<R, const T *> &&
                 std::is_void_v<std::invoke_result_t<R, const T *>>;

template <typename W, typename T>
concept BulkWriter =
    std::invocable<W, T *, size_t, size_t> &&
    std::convertible_to<std::invoke_result_t<W, T *, size_t, size_t>, size_t>;

template <typename R, typename T>
concept BulkReader =
    std::invocable<R, const T *, size_t, size_t> &&
    std::convertible_to<std::invoke_result_t<R, const T *, size_t, size_t>,
                        size_t>;
```
我们构造了四种概念(Concept)来约束用户传入的lambda，分别是单元素写入`Writer`、单元素读取`Reader`、批量写入`BulkWriter`和批量读取`BulkReader`。我们会在实现中以`    writer(&buffer_[head]);`的形式调用用户传入的lambda，从而实现原地构造。大部分时候，用户传入的接口如下形式：

```cpp
// 参数为指向T*的指针，在函数体内部可以对这个指针进行修改
auto writer = [](T* buffer) { /* Do something to the buffer */ };

// 参数为指向const T*的指针，在函数体内部只能读取这个指针
auto reader = [](const T* buffer) { /* Do something to the buffer */ };

// 批量写入，参数为指向T*的指针，元素数量n以及偏移量offset，需要返回一个size_t表示实际写入的元素数量
auto writer_bulk = [](T* buffer, size_t n, size_t offset) { /* Do something to the buffer[start:end] */ return count; };

// 批量读取，参数为指向const T*的指针，元素数量n以及偏移量offset，需要返回一个size_t表示实际读取的元素数量
auto reader_bulk = [](const T* buffer, size_t n, size_t offset) { /* Do something to the buffer[start:end] */ return count; };
```

这种方法既可以避免不必要的拷贝和构造开销，又能提供较高的灵活性，用户可以根据自己的需求对数据进行处理。缺点是调用接口较为复杂，并且目前实现中没有提供异常安全保证，用户需要自行处理异常情况。

### 内存模型

在多线程编程中，内存序模型(Memory Order)是一个非常重要的概念，它定义了不同线程对共享变量的操作顺序。具体的内存序模型以及超出了本文的范畴，具体可以参考[这篇文章](https://www.cnblogs.com/gaoxingnjiagoutansuo/p/16383137.html)。在此我们只是简单介绍一下我们在实现中使用的内存序模型。在多线程编程中，由于CPU/编译器的指令重排，与缓存一致性协议等等原因，实际上代码执行的顺序可能和代码编写的顺序不同，比如：

```cpp
void thread1(){
    a = 1;
    atomic.store(1);
    b = 1;    
}

void thread2(){
    if(atomic.load() == 1){
        assert(a == 1);
    }    
}
```

在编写代码时我们可能会期望当thread2看见`atomic`为1时，在`atomic.store(1)`前执行的`a = 1`一定被thread2看见，但是实际上由于指令重排等原因，`a = 1`指令在thread2执行到assert时并不可见，于是触发assert失败。

cpp中提供了`memory_order_release`和`memory_order_acquire`两个内存序来应对这个情况。
- `memory_order_release` : 在当前线程T1中，该操作X之前的任何读写操作指令都不能放在操作X之后。如果其它线程对同一变量使用了memory_order_acquire或者memory_order_consume约束符，则当前线程写操作之前的任何读写操作都对其它线程可见(注意consume的话是依赖关系可见)
- `memory_order_acquire` : 在当前线程中，load操作之后的所有读写操作都不能被重排到当前指令前。如果有其他线程使用memory_order_release内存模型对此原子变量进行store操作，在当前线程中是可见的。

可以简单理解成这一对约束像两个只阻挡一面的Barrier，配合起来便能实现基于原子变量的同步操作。

但是在X86-64架构中，其本身使用的TSO(Total Store Ordering)保证了 `store-load` 重排序的限制，使得在大多数情况下relaxed内存序就足够了，我们在实现中便可以不加入对应的约束，X86-64与TSO请参考[这篇文章](https://zhuanlan.zhihu.com/p/563126878)。

```cpp
#ifdef __x86_64__
  // X86-64使用TSO模型，硬件层面已经提供了足够的内存序保证
  // 对于SPSC队列的使用场景，relaxed内存序通常已足够
  static constexpr auto store_order = std::memory_order_relaxed;
  static constexpr auto load_order = std::memory_order_relaxed;
#else
  // 其他架构可能需要显式的同步语义
  static constexpr auto store_order = std::memory_order_release;
  static constexpr auto load_order = std::memory_order_acquire;
#endif
```

## 队列实现

讲完了设计，具体的实现便很简单了，首先看看写入操作的核心函数，也就短短几行：

```cpp
  template <Writer<T> W> [[gnu::hot]] bool push_with_writer(W writer) noexcept {
    const size_t head = prod_.head.load(std::memory_order_relaxed);
    const size_t next_head = nextIndex(head);

    if (next_head == prod_.cached_tail) [[unlikely]] {
      prod_.cached_tail = cons_.tail.load(load_order);
      if (next_head == prod_.cached_tail) [[unlikely]] {
        return false;
      }
    }

#ifdef ENABLE_PREFETCH
    __builtin_prefetch(&buffer_[head], 1, 1);
#endif

    writer(&buffer_[head]);
    prod_.head.store(next_head, store_order);
    return true;
  }
```

核心逻辑便是 : 获取`head` -> 通过本地缓存检查队列是否满 -> 写入队列。我们用了分支预测，数据预取等方式进一步提高了效率。

我们为此函数提供了一些抽象接口供用户使用：
```cpp
    // 简单的完美转发模板
  template <typename U>
  bool push(U &&value) noexcept
    requires(!Writer<U, T>)
  {
    return push_with_writer([value = std::forward<U>(value)](T *buffer) {
        *buffer = std::move(value);
    });
  }
    // 直接使用writer版本
  template <typename U>
  bool push(U writer) noexcept
    requires(Writer<U, T>)
  {
    return push_with_writer(writer);
  }

```

接着是读取操作的核心函数：

```cpp
  template <Reader<T> R> [[gnu::hot]] bool pop(R reader) noexcept {
    const size_t tail = cons_.tail.load(std::memory_order_relaxed);

    if (tail == cons_.cached_head) [[unlikely]] {
      cons_.cached_head = prod_.head.load(load_order);
      if (tail == cons_.cached_head) [[unlikely]] {
        return false;
      }
    }

    // 让 reader 直接读取缓冲区位置
    reader(&buffer_[tail]);
    cons_.tail.store(nextIndex(tail), store_order);
    return true;
  }

  bool pop(T &value) noexcept {
    return pop([&value](const T *buffer) { value = *buffer; });
  }
```

同样的逻辑 : 获取`tail` -> 通过本地缓存检查队列是否空 -> 读取队列。

以及同样重要的两种批量操作：
```cpp
  // 批量 Writer 操作
  template <BulkWriter<T> W>
  size_t push_bulk(W writer, size_t max_count) noexcept {
    const size_t head = prod_.head.load(std::memory_order_relaxed);
    size_t tail;

    tail = prod_.cached_tail;

    size_t available = available_space(head, tail);
    if (available < max_count) [[unlikely]] {
      tail = cons_.tail.load(load_order);
      prod_.cached_tail = tail;
      available = available_space(head, tail);
    }

    const size_t can_write = std::min(max_count, available);
    if (can_write == 0) [[unlikely]] {
      return 0;
    }

    const size_t end_of_buffer = Capacity - head;

    if (can_write <= end_of_buffer) [[likely]] {
      // 预取
      T *dest = &buffer_[head];
      for (size_t i = 0; i < can_write; i += CacheLineSize / sizeof(T)) {
        __builtin_prefetch(dest + i + CacheLineSize / sizeof(T), 1, 0);
      }
      // 连续写入
      writer(&buffer_[head], can_write, 0);
    } else {
      // 分两段写入
      const size_t part1 = end_of_buffer;
      writer(&buffer_[head], part1, 0);
      const size_t part2 = can_write - part1;
      writer(&buffer_[0], part2, part1);
    }
    prod_.head.store(nextIndex(head, can_write), store_order);

    return can_write;
  }

  size_t push_bulk(const T *data, size_t count) noexcept {
    return push_bulk(
        [data](T *buffer, size_t n, size_t offset) {
          std::memcpy(buffer, data + offset, n * sizeof(T));
          return n;
        },
        count);
  }

  // 批量 Reader 操作
  template <BulkReader<T> R>
  size_t pop_bulk(R reader, size_t max_count) noexcept {
    const size_t tail = cons_.tail.load(std::memory_order_relaxed);
    size_t head;

    head = cons_.cached_head;

    size_t available = available_space(tail, head + 1);
    if (available < max_count) [[unlikely]] {
      head = prod_.head.load(load_order);
      cons_.cached_head = head;
      available = available_space(tail, head + 1);
    }

    const size_t can_read = std::min(max_count, available);
    if (can_read == 0) [[unlikely]] {
      return 0;
    }

    const size_t end_of_buffer = Capacity - tail;

    if (can_read <= end_of_buffer) [[likely]] {
      // 预取
      const T *src = &buffer_[tail];
      for (size_t i = 0; i < can_read; i += CacheLineSize / sizeof(T)) {
        __builtin_prefetch(src + i + CacheLineSize / sizeof(T), 0, 0);
      }
      // 连续读取
      reader(&buffer_[tail], can_read, 0);
    } else {
      // 分两段读取
      const size_t part1 = end_of_buffer;
      reader(&buffer_[tail], part1, 0);
      const size_t part2 = can_read - part1;
      reader(&buffer_[0], part2, part1);
    }
    if (can_read > 0) {
      cons_.tail.store(nextIndex(tail, can_read), store_order);
    }
    return can_read;
  }

  size_t pop_bulk(T *data, size_t count) noexcept {
    return pop_bulk(
        [data](const T *buffer, size_t n, size_t offset) {
          std::memcpy(data + offset, buffer, n * sizeof(T));
          return n;
        },
        count);
  }
```

批量模式的接口与单元素模式类似，只不过需要处理环形缓冲区的边界情况，并且在写入和读取前进行了数据预取以提高性能，并且由于分支等指令的减少，批量操作的效率通常会非常高。

## 性能测试

我们采用`CPU: Intel(R) Xeon(R) W-2123 (8) @ 3.90 GHz`,`RAM: 64GB DDR4 2666MHz`的机器进行测试，所有测试代码均使用`g++ -O3 -std=c++20`进行编译，测试代码部分如下：

```cpp
// 单线程performance
template <typename Q> void test_performance_spsc_(Q &q, const size_t N) {
  for (size_t i = 0; i < N; ++i) {
    while (!q.push(i)) {
    }
    int v;
    while (!q.pop(v)) {
    }
  }
}

// 多线程performance(不可避免的有创建线程的开销，我们通过足够大的N来减少这个影响)
template <typename Q> void test_performance_mt_(Q &q, const size_t N) {
  std::atomic<bool> done{false};
  std::thread prod([&] {
    for (int i = 0; i < N; ++i) {
      while (!q.push(i))
        std::this_thread::yield();
    }
    done = true;
  });

  std::thread cons([&] {
    int v, cnt = 0;
    while (!done || cnt < N) {
      if (q.pop(v))
        ++cnt;
      else
        std::this_thread::yield();
    }
  });

  prod.join();
  cons.join();
}
// 多线程bulk操作测试
template <size_t BATCH, typename Q>
void test_bulk_multithread_(Q &q, const size_t N) {
  std::atomic<bool> done{false};

  std::thread prod([&] {
    int arr[BATCH];
    for (int i = 0; i < N; i += BATCH) {
      int this_batch = std::min(BATCH, N - i);
      for (int j = 0; j < this_batch; ++j)
        arr[j] = i + j;
      size_t pushed = 0;
      while (pushed < this_batch)
        pushed += q.push_bulk(arr + pushed, this_batch - pushed);
    }
    done = true;
  });

  std::thread cons([&] {
    int arr[BATCH];
    int cnt = 0;
    while (!done || cnt < N) {
      size_t popped = q.pop_bulk(arr, BATCH);
      for (size_t j = 0; j < popped; ++j) {
        ASSERT_EQ(arr[j], cnt);
        ++cnt;
      }
      if (popped == 0)
        std::this_thread::yield();
    }
  });

  prod.join();
  cons.join();
}

```

我们同样编写了相同但是接口不同的raomeng SPSC测试代码，由于大部分逻辑相同，这里就不多展示。

下面是横向对比的测试结果：(SPSCQueue<Cache,Align>为本文实现，SPSCQueueOPT为raomeng的实现)
```bash
[INFO] Performance test (single-thread loop)
[INFO] SPSCQueue<Cache,Align> performance test
[INFO] SPSCQueue<Cache,Align> throughput: 1081.788097 Mops/s
[INFO] SPSCQueueOPT performance test
[INFO] SPSCQueueOPT throughput: 660.359615 Mops/s
[INFO] SPSC multi-thread performance test - cap=1024, N=10000000, iter=100
[INFO] SPSCQueue<Cache,Align> throughput: 766.499728 Mops/s
[INFO] SPSCQueueOPT throughput: 311.134780 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=32, iter=100
[INFO] SPSCQueue<Cache,Align> bulk throughput: 1422.482236 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=64, iter=100
[INFO] SPSCQueue<Cache,Align> bulk throughput: 2015.333485 Mops/s
[INFO] All SPSC tests completed successfully
```
由上述结果可以看出，我们的实现无论是在单线程还是多线程场景下，性能均显著优于raomeng的实现，尤其是在批量操作模式下，性能提升尤为明显，最高达到了惊人的2Gops/s(代表每个操作的延迟只需要0.5ns)!!

## 纵向性能测试

本节我们将对本文实现进行一些纵向的性能测试，来分析不同设计对性能的影响。

### False Sharing影响

我们通过移除`ProducerState`和`ConsumerState`结构体中的`padding`和`alignas(CachelineSize)`来模拟伪共享问题，测试结果如下：

```bash
[INFO] Performance test (single-thread loop)
[INFO] SPSCQueue<Cache,NoAlign> performance test
[INFO] SPSCQueue<Cache,NoAlign> throughput: 1087.431591 Mops/s
[INFO] SPSC multi-thread performance test - cap=1024, N=10000000, iter=100
[INFO] SPSCQueue<Cache,NoAlign> throughput: 347.055568 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=32, iter=100
[INFO] SPSCQueue<Cache,NoAlign> bulk throughput: 823.888940 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=64, iter=100
[INFO] SPSCQueue<Cache,NoAlign> bulk throughput: 1290.250316 Mops/s
[INFO] All SPSC tests completed successfully
```
可以很明显看出来，在单个线程的情况下，伪共享并没有带来太大的影响，但是在多线程的场景下，性能下降了近一半，这也验证了前文中伪共享问题对多线程性能的严重影响。

### 缓存影响

我们通过移除`cached_head`和`cached_tail`来模拟没有本地缓存的情况，测试结果如下：

```bash
[INFO] Performance test (single-thread loop)
[INFO] SPSCQueue<NoCache,Align> performance test
[INFO] SPSCQueue<NoCache,Align> throughput: 1125.368144 Mops/s
[INFO] SPSC multi-thread performance test - cap=1024, N=10000000, iter=100
[INFO] SPSCQueue<NoCache,Align> throughput: 473.598290 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=32, iter=100
[INFO] SPSCQueue<NoCache,Align> bulk throughput: 1010.907816 Mops/s
[INFO] SPSC bulk multi-thread test - cap=1024, N=10000000, BATCH=64, iter=100
[INFO] SPSCQueue<NoCache,Align> bulk throughput: 1454.160013 Mops/s
[INFO] All SPSC tests completed successfully
```
在单线程模式下，移除缓存甚至有略微的提升(可能是由于减少了内存占用和更好的缓存利用率)，但是在多线程模式下，性能下降了约30%，这也验证了本地缓存对多线程性能的显著提升。(减少对对方状态的访问不仅可以减少原子变量的读取，也减少了因为缓存失效带来的性能开销)


### 其他影响

其他影响诸如预取，分支预测，内存序模型等在本文实现中均有涉及，但是由于时间有限和影响较小，这里就不进行过多的测试了，感兴趣的读者可以自行尝试。

### 总结
最终的测试结果汇总如下：
| 版本               | 单线程(Mops/s) | 多线程(Mops/s) | 批量32(Mops/s) | 批量64(Mops/s) |
|------------------|----------------|----------------|----------------|----------------|
| SPSCQueue<Cache,Align> | 1081.79        | 766.50        | 1422.48       | 2015.33       |
| SPSCQueue<Cache,NoAlign> | 1087.43        | 347.06        | 823.89        | 1290.25       |
| SPSCQueue<NoCache,Align> | 1125.37        | 473.60        | 1010.91       | 1454.16       |
| SPSCQueueOPT     | 660.36         | 311.13         | N/A            | N/A            |

通过上述的测试和分析，我们可以看到本文实现的SPSC队列在设计上充分考虑了多线程编程中的各种性能影响因素，如伪共享、本地缓存等，并通过合理的接口设计和内存序模型选择，达到了超高的性能表现。希望本文能对读者在多线程编程和高性能数据结构设计方面有所启发。

详细代码请参考仓库：
::github{repo="Qiuarctica/MultiTools"}