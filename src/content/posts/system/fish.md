---
title: 为什么推荐你使用Fish shell
published: 2025-04-06
tags: [Linux]
category: 系统杂谈
description: 对Fish的简要介绍与推荐
image: "../../../assets/fish.png"
draft: false
---

# 为什么推荐你使用Fish shell

:::important

先说结论,Fish shell泛用性极强,对策性较高,总体适用性超大杯偏上,推荐一般用户使用.

:::

与 Bash 或 Zsh 这类功能强大但需要大量配置才能好用的 Shell 不同，Fish 的设计哲学是  **“默认即完美”**  。安装完成后，你无需安装 Oh My Zsh 之类的配置框架，立刻就能获得一系列提升效率的现代化特性。对于喜欢开箱即用以及简洁,现代的UI的用户,Fish可能是你的最佳选择.

## 安装Fish

进入fish官网[fish shell](https://fishshell.com/)寻找适合自己系统的安装方案即可，大部分均可以通过包管理器进行一键式安装，在此不过多赘述.

## 开箱即用

我认为Fish最吸引我也是最大的特点就是**开箱即用**的能力,其自带功能包括:

1. 语法高亮（Syntax Highlighting），fish自带较为完善的语法高亮，能够区分有效与无效命令，对于文件输入有特殊下划线反馈。
2. 自动建议（Autosuggestions）与自动补全（Tab Completions），Fish提供了一套自动分析文件名，可执行文件名，命令行选项，历史输入，git分支等等的自动建议与补全功能，整体体验下来还是很不错很智能的。
3. 简洁的主题，Fish自带的主题样式既简洁又美观深得我心。

## 差异性

Fish 的强大源于其现代化的设计，但这也意味着它**不完全兼容 Bash等传统shell**。以下为日常使用中常见的需要额外适应于学习的部分：

### 变量（核心差异）

fish在变量设置上与传统shell不同，这也是从bash，zsh转向fish必须经历的转变。fish的变量设置由其内置指令`set`管理，其提供了一套强大且现代的变量管理体系。

```shell
qiuy@localhost ~> set --help
set - display and change shell variables

   set [SCOPE_OPTIONS]
   set [OPTIONS] VARIABLE_NAME VALUES...
   set [OPTIONS] VARIABLE_NAME[INDICES]... VALUES...
   set ( -q | --query ) [SCOPE_OPTIONS] VARIABLE_NAMES...
   set ( -e | --erase ) [SCOPE_OPTIONS] VARIABLE_NAME...
   set ( -e | --erase ) [SCOPE_OPTIONS] VARIABLE_NAME[INDICES]...
   set ( -S | --show ) [VARIABLE_NAME]...
```

fish中的变量由作用域与变量名构成，作用域由`[SCOPE_OPTIONS]`控制，有字符串和字符串列表两种类型（列表由空格作为分隔符，如`$PATH`，而不是传统Shell中以冒号为分隔符的字符串）。常见作用域如下表所示：

|-l/--local|-g/--global|-U/--universal|-x/--export|
| :----------: | :--------------------------: | :------------------------: | :----------------------------------------: |
|局部变量|全局变量，仅在本进程中生效|全局变量，设置后永久生效|会被导出给子进程的变量，可以看作环境变量|

同时，set还提供了-a/--append ，-p/--prepend，-e/--erase等参数来帮助开发者管理变量。

于是，对于传统的`export Val=A`的变量设置，我们可以替换为`set -x Val A`，以及传统的环境变量设置方式（fish不支持）`export PATH=$PATH:xxx`，在fish中则需要修改为`set -a PATH xxx`，以下为一些示例：

```shell
qiuy@localhost ~> set -x path_example 1 # 设置环境变量
qiuy@localhost ~> echo $path_example
1
qiuy@localhost ~> set -a path_example 2 # append到列表最后
qiuy@localhost ~> echo $path_example
1 2
qiuy@localhost ~> set -e path_example[1] # 删除列表第一项（注意，fish列表从1开始索引）
qiuy@localhost ~> echo $path_example
2
qiuy@localhost ~> set -x path_example 2 2 3 # 覆盖变量
qiuy@localhost ~> echo $path_example
2 2 3
qiuy@localhost ~> set -x path_example (string match -v "3" $path_example ) # 用字符串匹配删除某一项
qiuy@localhost ~> echo $path_example
2 2
```

对于`PATH`的管理，fish还提供了`fish_user_paths`（fish管理的通用变量列表，其内容会自动添加到`PATH`中）以及`fish_add_path`等命令提供更加安全简洁并包含自动去重的`PATH`管理，详细的说明可以自行参考fish官方教程[教程 — fish-shell 4.0.2 文档](https://fishshell.com/docs/current/tutorial.html#path)

### 语法差异

1. fish中的条件与循环结束标识符均使用了`end`更加简洁明了。

    ```shell
    # Bash
    if [ "$name" = "foo" ]; then
      echo "Hi"
    fi

    for i in 1 2 3; do
      echo $i
    done

    # Fish
    if [ "$name" = "foo" ]
      echo "Hi"
    end

    for i in 1 2 3
      echo $i
    end
    ```

2. fish 用 `and`、`or` 代替了 `&&`、`||`，用 `test` 或 `[ ]` 代替了 `[ ]`，可读性更强
3. fish的命令替换功能从`$(command)`改为了`(command)`，例如：

    ```shell
    # Bash: `command` 或 $(command)
    echo "Today is $(date)"
    # Fish: (command)
    echo "Today is "(date)
    ```

同样的，更多差异请见fish官方文档，在此只列举常见的几个。

### 配置文件

fish 使用多个配置文件来管理不同的设置，这些文件位于` ~/.config/fish/` 目录中，其中主要配置文件`config.fish`在每次启动fish时都会执行（类似.bashrc，.zshrc），还包括自动补全配置文件目录`~/.config/fish/completions`，以及插件配置`~/.config/fish/conf.d`等等。

### 函数文件

fish的函数定义位于`~/.config/fish/functions/`目录下，一般来说一个文件对应一个函数，其函数语法以及参数读取等请自行参考教程，非深度用户一般不会使用，以下给一个简单的函数定义示例：

```shell
# setproxy.fish
function setproxy
        export http_proxy="http://localhost:7777"
        export https_proxy="http://localhost:7777"
        export all_proxy="http://localhost:7777"
end
```

在定义函数后，fish会在调用时自动加载，无需重启fish

## 额外功能

### 命令行工具

fish提供了许多强力的内置命令行工具，如前文提到的`set`，还包括`string`，`math`，`count`，`argparse`等等。

```shell
> string --help
string - manipulate strings

string collect [-a | --allow-empty] [-N | --no-trim-newlines] [STRING ...]
string escape [-n | --no-quoted] [--style=] [STRING ...]
string join [-q | --quiet] [-n | --no-empty] SEP [STRING ...]
string join0 [-q | --quiet] [STRING ...]
string length [-q | --quiet] [STRING ...]
string lower [-q | --quiet] [STRING ...]
string match [-a | --all] [-e | --entire] [-i | --ignore-case]
             [-g | --groups-only] [-r | --regex] [-n | --index]
             [-q | --quiet] [-v | --invert]
             PATTERN [STRING ...]
```

### 插件

fish可以通过`fisher`进行插件管理，其可以从github，本地等源下载插件与主题，并提供了简单的插件管理机制。

::github{repo="jorgebucaran/fisher"}

可以通过以下命令快速安装fisher：​​`curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher`​

可以在[fish-plugin · GitHub Topics](https://github.com/topics/fish-plugin)中浏览与查找现有的fish插件，[jorgebucaran/awsm.fish: A curation of prompts, plugins &amp; other Fish treasures 🐚💎](https://github.com/jorgebucaran/awsm.fish)中挑选一些**awesome**的fish插件。

::github{repo="jorgebucaran/awsm.fish"}

以下是一些我安装与推荐的插件:

```shell
qiuy@localhost ~> fisher list
jorgebucaran/fisher 
edc/bass # 在fish中执行bash脚本(通过python)
jorgebucaran/autopair.fish # 自动补充括号等
jethrokuan/z # z!!!
```

fish也可以进行主题的配置和下载，但本人并不推荐，因为我认为fish本体以及足够简洁美观，更多的主题可能会喧宾夺主了。

## 总结

**总而言之，fish shell 通过牺牲一部分与传统shell的兼容性，换来了无与伦比的交互体验和开发效率。**  这种权衡对于绝大多数现代开发者来说是绝对值得的。

尝试 fish 的成本很低，安装并切换过去，用它工作一天。你很可能就会像我一样，再也回不去了。

**现在就安装试试吧！欢迎踏入fish shell的高效世界！**

‍
