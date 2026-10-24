/*
 * gen-fish-model.js —— 从 tools/fish-appearance.json + tools/fish-model.js 生成 Java：
 *
 *   client/model/ModFishModel.java   每种鱼自己的零件表（尺寸 / 姿态 / texOffs）+ 图集尺寸
 *   registry/ModModelLayers.java     21 个模型层（一种鱼一层）
 *   fish/FishVariants.java           21 种鱼的渲染缩放与碰撞箱
 *   registry/ModItems.java           21 个刷怪蛋字段 + 创造页签上架行（注入生成块）
 *   assets/.../lang/*.json           21 个刷怪蛋的中英文名
 *   assets/.../models/item/*_spawn_egg.json  （26.1.2：generated + 每蛋贴图）
 *   assets/.../items/*_spawn_egg.json         （26.1.2 的物品模型定义，指向上面那个模型）
 *
 * 这些文件**整份生成**（ModItems/lang 是注入生成块），不要手工改。
 * 要改鱼的外形请改 tools/fish-appearance.json 或 tools/fish-model.js。
 *
 * ── 2026-10-01：从"4 组共用"改成"每种鱼一层" ──────────────────
 * 上一版 4 组共用网格、组内只靠三轴缩放，用户的反馈是「模板套用很严重」。
 * 缩放改不了形状，所以现在每种鱼按自己的 shape 展开零件、独立装箱、独立烘一层。
 * 代价只有 21 个小组网格，换来的是每条鱼可以有自己的吻型、尾型、鳍长与位置。
 */
const fs = require('fs');
const path = require('path');
const M = require('./fish-model');

// ATL_ROOT 供 tools/negtest.ps1 把生成/检查指向临时副本。
// ⚠ 必须和 fish-model.js 用同一套解析（ATL_ROOT 否则 __dirname 的上一级），
//   否则检查器会拿**副本的数据**去比**真实仓库的文件**，对照组必然报漂移。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const CHECK = process.argv.includes('--check');

/**
 * 比较前归一换行。
 *
 * ⚠ 仓库存 LF，`core.autocrlf=true` 的 Windows 检出是 CRLF —— 那是**检出方式**，
 *   不是内容漂移。不归一的话，`--check` 在 CRLF 检出上会把这几个"整份生成"的文件
 *   永远报成不一致，而 `--write` 又只是把行尾改一遍（git 里连 diff 都看不到）。
 *   归一之后"内容一致"与"逐字节一致"在**去掉行尾差异**的意义上等价，
 *   断言强度不变（check-fish-model.js 用的是同一个 norm）。
 */
const norm = (s) => (s == null ? null : String(s).replace(/\r\n/g, '\n'));

const f = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  if (Math.abs(r - Math.PI / 4) < 1e-6) return "(float) Math.PI / 4.0F";
  if (Math.abs(r + Math.PI / 4) < 1e-6) return "-(float) Math.PI / 4.0F";
  if (Math.abs(r - Math.PI / 2) < 1e-6) return "(float) Math.PI / 2.0F";
  if (Number.isInteger(r)) return r + '.0F';
  return r + 'F';
};

const HEADER = (pkg) => `package ${pkg};

/*
 * ⚠ 本文件由 tools/gen-fish-model.js **整份生成**，不要手工修改。
 *   数据源：tools/fish-appearance.json（每种鱼的 shape/颜色）+ tools/fish-model.js（几何与 UV 装箱）
 *   重新生成：node tools/gen-fish-model.js
 */

`;

const IDS = () => Object.keys(M.data.fish);

// ---------------------------------------------------------------- ModFishModel.java
function genModel() {
  const ids = IDS();
  const L = [];
  L.push(HEADER('com.whitecobalt.anglertackle.client.model'));
  L.push(`import com.whitecobalt.anglertackle.client.render.state.FishRenderState;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.util.Mth;

/**
 * 通用鱼模型 —— 21 种鱼，**一种鱼一层**。
 *
 * <p>每层的零件表（盒子尺寸、姿态、texOffs、图集尺寸）都是
 * {@code tools/gen-fish-model.js} 从该鱼的 shape 参数算出来的，手写不出来：
 * texOffs 是货架装箱的结果，抄错一个数字的表现是"鱼身上出现别的零件的颜色"，
 * 不报错、只难看。
 *
 * <p><b>为什么是一种鱼一层而不是四组共用</b>：上一版 4 组共用网格、组内靠三轴缩放，
 * 用户的反馈是「模板套用很严重」「看不出狗鱼与其他鱼的那种明显的外形区别」。
 * 缩放改不了形状 —— 吻型、尾型、鳍的位置与长度都必须真的不同。
 * 21 个小组网格的代价可以忽略（原版有几百个模型层）。
 *
 * <p><b>朝向约定</b>：吻端在 -Z，尾在 +Z，体轴在 y = 24 - 体高/2 - 1
 * （抬高 1 格是为了给向下的臀鳍留位置，让鱼的最低点正好落在 y=24 的"地面"上）。
 */
public class ModFishModel extends EntityModel<FishRenderState> {

    /**
     * 会摆动的零件名。不同鱼种的尾型不同（叉尾/圆尾/新月尾/歪尾），
     * 构造时按鱼种挑出实际存在的那几个 —— 不存在的零件 getChild 会抛异常。
     */
    private static final String[] TAIL_PARTS = {
            "tail_fork_up", "tail_fork_lo", "tail_round",
            "tail_crescent_up", "tail_crescent_lo",
            "tail_hetero_up", "tail_hetero_lo",
    };

    private static final String[] EMPTY = new String[0];

    private final List<ModelPart> tails = new ArrayList<>();

    public ModFishModel(ModelPart root, String species) {
        super(root);
        for (String name : TAILS.getOrDefault(species, EMPTY)) {
            this.tails.add(root.getChild(name));
        }
    }

    /**
     * 鱼种 id → 网格。
     *
     * <p>图集尺寸必须和 {@code gen-fish-textures.js} 画出来的 PNG 完全一致 ——
     * 不一致的表现是 UV 整体错位（鱼身上出现别的零件的颜色），不报错。
     * 两边都从同一份 {@code fish-model.js} 结果读，所以不会走散。
     */
    public static LayerDefinition createBodyLayer(String species) {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition root = mesh.getRoot();
        switch (species) {
${ids.map((id) => `            case "${id}" -> build_${id}(root);`).join('\n')}
            default -> throw new IllegalArgumentException("未知鱼种：" + species);
        }
        return LayerDefinition.create(mesh, ATLAS_W.getOrDefault(species, 64), ATLAS_H.getOrDefault(species, 64));
    }

${ids.map((id) => {
    const S = M.species[id];
    const lines = S.parts.map((p) => {
      const b = p.box.map((v) => f(v)).join(', ');
      const a = p.at.map((v) => f(v));
      const r = p.rot || [0, 0, 0];
      const rotated = r.some((v) => v !== 0);
      const pose = rotated
        ? `PartPose.offsetAndRotation(${a[0]}, ${a[1]}, ${a[2]}, ${r.map((v) => f(v)).join(', ')})`
        : `PartPose.offset(${a[0]}, ${a[1]}, ${a[2]})`;
      const [u, v] = S.texOffs[p.name];
      return `        root.addOrReplaceChild("${p.name}", CubeListBuilder.create().texOffs(${u}, ${v})` +
        `.addBox(${b}), ${pose});`;
    });
    return `    /** ${id} —— ${S.parts.length} 个零件，图集 ${S.atlasW}×${S.atlasH} */\n` +
      `    private static void build_${id}(PartDefinition root) {\n${lines.join('\n')}\n    }\n`;
  }).join('\n')}
    private static final Map<String, String[]> TAILS = Map.ofEntries(
${ids.map((id) => {
    const names = M.species[id].parts
      .map((p) => p.name)
      .filter((n) => n === 'tail_round' || n.startsWith('tail_fork') ||
        n.startsWith('tail_crescent') || n.startsWith('tail_hetero'));
    return `            Map.entry("${id}", new String[]{${names.map((n) => `"${n}"`).join(', ')}})`;
  }).join(',\n')}
    );

    private static final Map<String, Integer> ATLAS_W = Map.ofEntries(
${ids.map((id) => `            Map.entry("${id}", ${M.species[id].atlasW})`).join(',\n')}
    );

    private static final Map<String, Integer> ATLAS_H = Map.ofEntries(
${ids.map((id) => `            Map.entry("${id}", ${M.species[id].atlasH})`).join(',\n')}
    );

    @Override
    public void setupAnim(FishRenderState state) {
        // 摆尾：照抄 CodModel，出水时摆得更快。
        // 四种尾型（叉/圆/新月/歪尾）共用这一句，只是各自只有属于自己的零件存在。
        float f = state.isInWater ? 1.0F : 1.5F;
        float swing = -f * 0.45F * Mth.sin(0.6F * state.ageInTicks);
        for (ModelPart tail : this.tails) {
            tail.yRot = swing;
        }
    }
}
`);
  return L.join('');
}

// ---------------------------------------------------------------- ModModelLayers.java
function genModelLayers() {
  const ids = IDS();
  return `package com.whitecobalt.anglertackle.registry;

/*
 * ⚠ 本文件由 tools/gen-fish-model.js **整份生成**，不要手工修改。
 *   重新生成：node tools/gen-fish-model.js
 */

import com.whitecobalt.anglertackle.AnglersTackle;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.resources.Identifier;

/**
 * 模型层（LayerDefinition）的声明。
 *
 * <p>⚠ 1.21 把两件事拆开了：ModelLayers 只声明 ModelLayerLocation 常量，
 * 真正的 LayerDefinition 注册在 geom/LayerDefinitions 里。我们自己的模型自己注册，
 * 所以这个类只放常量声明。
 *
 * <p><b>一种鱼一层</b>（21 层），不是 4 组共用 —— 理由见 ModFishModel 的类注释。
 * 层 id → 烘哪套网格的映射由 {@code ClientSetup} 直接遍历本表注册，两边不会走散。
 */
public final class ModModelLayers {

    /** 鱼种 id → 模型层。 */
    public static final Map<String, ModelLayerLocation> FISH = buildFishLayers();

    private static Map<String, ModelLayerLocation> buildFishLayers() {
        String[] species = {${ids.map((id) => `"${id}"`).join(', ')}};
        Map<String, ModelLayerLocation> map = new LinkedHashMap<>();
        for (String s : species) {
            map.put(s, new ModelLayerLocation(
                    Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "fish_" + s), "main"));
        }
        return Map.copyOf(map);
    }

    private ModModelLayers() {
    }
}
`;
}

// ---------------------------------------------------------------- FishVariants.java
function genVariants() {
  const ids = IDS();
  return HEADER('com.whitecobalt.anglertackle.fish') + `import java.util.HashMap;
import java.util.Map;

/**
 * 21 种鱼的**尺寸**表：渲染缩放与碰撞箱。
 *
 * <p>形状不在这里 —— 形状是每种鱼一套网格，见 {@code ModFishModel}；这里只放"多大"。
 *
 * <p>数字由 tools/fish-model.js 从真实体长算出：
 * <pre>
 *   目标模型长度 = 2.98 × 体长(cm)^0.48      （1 模型单位 = 1/16 格）
 *   缩放         = 目标长度 / 该鱼自己的模型全长
 * </pre>
 * 0.48 次方把 25 倍的真实体长差压成 4.2 倍尺寸差；只此一处归一，不再额外压缩。
 *
 * <p><b>碰撞箱和缩放同源</b>：手写尺寸表的坑是"模型放大了判定框没跟着动"，
 * 表现是鱼比自己的判定框大一圈、用桶捞会捞到空气。
 */
public final class FishVariants {

    /**
     * @param sx/sy/sz 渲染缩放（见 ModFishRenderer.scale）
     * @param hitW/hitH 实体碰撞箱宽×高（格）
     * @param centerZ 模型 z 方向的中点（模型单位，1 格 = 16）——
     *                鱼模型的 z 原点在头身交界而不是鱼的中心，摆到方块上要用它居中
     */
    public record Variant(float sx, float sy, float sz, float hitW, float hitH, float centerZ) {
    }

    private static final Map<String, Variant> BY_SPECIES = new HashMap<>();

    private static final Variant FALLBACK = new Variant(1.0F, 1.0F, 1.0F, 0.6F, 0.35F, 0.0F);

    static {
${ids.map((id) => {
    const S = M.species[id];
    return `        BY_SPECIES.put("${id}", new Variant(${f(S.scale[0])}, ${f(S.scale[1])}, ${f(S.scale[2])}, ` +
      `${f(S.hit[0])}, ${f(S.hit[1])}, ${f(S.centerZ)}));`;
  }).join('\n')}
    }

    public static Variant of(String speciesId) {
        Variant v = speciesId == null ? null : BY_SPECIES.get(speciesId);
        return v == null ? FALLBACK : v;
    }

    private FishVariants() {
    }
}
`;
}

// ---------------------------------------------------------------- 鱼刷怪蛋
/**
 * 21 个鱼刷怪蛋。为什么要"生成"而不是手写：
 *
 *  ① 蛋壳的两种颜色（底色 + 斑点）直接取该鱼的**背部色**与**花纹色**，
 *     和模型贴图同源 —— 改了配色，蛋的颜色跟着变，不会出现"鱼是蓝的、蛋是绿的"。
 *  ② 刷怪蛋牵扯**四张表**：物品注册 / 创造页签 / 中英文语言键 / 模型 json。
 *     手写 21×4 = 84 处，漏一处的表现各不相同且都不报错。
 *  ③ 蛋的 tooltip 会显示鱼种 id，方便对照报错："第 7 行那个是 tigerfish"。
 */
const EGG_BEGIN = '    // ==== BEGIN 鱼刷怪蛋字段（gen-fish-model.js 生成，勿手改）====';
const EGG_END = '    // ==== END 鱼刷怪蛋字段 ====';
const EGG_TAB_BEGIN = '                        // ==== BEGIN 鱼刷怪蛋上架（gen-fish-model.js 生成，勿手改）====';
const EGG_TAB_END = '                        // ==== END 鱼刷怪蛋上架 ====';

const FQ = {
  entities: 'com.whitecobalt.anglertackle.registry.ModEntities',
  egg: 'com.whitecobalt.anglertackle.item.FishSpawnEggItem',
};
const constName = (id) => id.toUpperCase() + '_SPAWN_EGG';

/** 中文名以 zh_cn.json 为准（名字只有一处真源，不在这里再抄一份）。 */
function zhName(id) {
  const zh = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'src/main/resources/assets/anglertackle/lang/zh_cn.json'), 'utf8'));
  return zh['item.anglertackle.' + id] || id;
}

function eggFields() {
  const lines = IDS().map((id) => {
    const c = M.data.fish[id].colors;
    const base = c.back, spot = c.mark || c.flank;
    return `    /** ${zhName(id)} —— 调试用刷怪蛋，上架前连同创造页签那一行一起删（见 docs/12 打包清单）。 */\n` +
      `    public static final DeferredItem<${FQ.egg}> ${constName(id)} =\n` +
      `            ITEMS.register("${id}_spawn_egg", () -> new ${FQ.egg}(\n` +
      `                    ${FQ.entities}.FISHES.get("${id}"), "${id}", 0x${base.slice(1)}, 0x${spot.slice(1)},\n` +
      `                    new Item.Properties().setId(itemKey("${id}_spawn_egg"))));`;
  });
  const map = IDS().map((id) => `        map.put("${id}", ${constName(id)});`).join('\n');
  return EGG_BEGIN + '\n' + lines.join('\n\n') + '\n\n' +
    '    /** 鱼种 id → 刷怪蛋。给调试命令与检查脚本用，顺序与 FISH_IDS 一致。 */\n' +
    `    public static final java.util.Map<String, DeferredItem<${FQ.egg}>> FISH_SPAWN_EGGS =\n` +
    '            buildEggMap();\n\n' +
    `    private static java.util.Map<String, DeferredItem<${FQ.egg}>> buildEggMap() {\n` +
    `        java.util.Map<String, DeferredItem<${FQ.egg}>> map = new java.util.LinkedHashMap<>();\n` +
    map + '\n' +
    '        return java.util.Collections.unmodifiableMap(map);\n' +
    '    }\n' + EGG_END;
}

function eggTabLines() {
  return EGG_TAB_BEGIN + '\n' +
    IDS().map((id) => `                        output.accept(${constName(id)}.get());`).join('\n') +
    '\n' + EGG_TAB_END;
}

/**
 * 刷怪蛋的**物品模型**（26.1.2）。
 *
 * ⚠ 26.1.2 删掉了 SpawnEggItem 的颜色构造器与 DeferredSpawnEggItem，原版不再有
 *   `template_spawn_egg` 那种"一张灰度图 + ItemColors 染色"的做法 —— 每个蛋必须有
 *   **自己的贴图**。所以这里是 generated + 每蛋 layer0，**不是** template_spawn_egg。
 *
 * ⚠ 贴图本身**不由本生成器负责**：48 张逐蛋图（16×16 RGBA，底色 = 背部色 /
 *   高光 = 花纹色）是 P2b 一次性脚本的产物，已入库在
 *   `assets/anglertackle/textures/item/<id>_spawn_egg.png`（47 条鱼 + 老柯）。
 *   重出贴图必须照 P2b 的两色模板做，**不要**在这里按 1.21.1 的染色思路生成旧模板图
 *   （旧模板在 26.1.2 没有颜色来源，蛋会变成纯灰）。
 */
function eggModelJson(id) {
  return JSON.stringify({
    parent: 'minecraft:item/generated',
    textures: { layer0: 'anglertackle:item/' + id + '_spawn_egg' },
  }, null, 2) + '\n';
}

/**
 * 刷怪蛋的**物品模型定义**（26.1.2 的 `assets/<ns>/items/<id>.json`）。
 *
 * <p>没有它，模型 json 摆在那里也**不会**被物品用上 —— 1.21.1 靠物品 id 直接找
 * `models/item/<id>.json`，26.1.2 改成先读 `items/<id>.json` 这个"入口"。
 * 缺了它的表现是紫黑方块，不报错。
 */
function eggItemDefinitionJson(id) {
  return JSON.stringify({
    model: { type: 'minecraft:model', model: 'anglertackle:item/' + id + '_spawn_egg' },
  }, null, 2) + '\n';
}

const EGG_SUFFIX = { zh: '刷怪蛋', en: ' Spawn Egg' };

/** 先按标记剥掉旧的生成块，再插到"插入点"锚注后面。锚注是手写的一行，永远留在文件里。 */
function injectModItems(src, begin, end, anchor, body) {
  const { stripExact } = require('./generated-blocks.js');
  let text = src;
  for (let i = 0; i < 50; i++) {
    const r = stripExact(text, begin, end);
    if (!r.hit) break;
    text = r.text;
  }
  if (!text.includes(anchor)) throw new Error('ModItems 里找不到插入点锚注：' + anchor.trim());
  return text.replace(anchor, anchor + '\n' + body);
}

/**
 * 语言 json 的**行式插入**：把 `item.anglertackle.<id>_spawn_egg` 插到对应鱼名的**下一行**，
 * 保持原文的排序与缩进，不整体重排。幂等：已存在的键跳过；倒序遍历以免插入位移影响定位。
 */
function injectLang(src, suffix) {
  let out = src;
  const ids = IDS().sort((a, b) => b.localeCompare(a));
  for (const id of ids) {
    const newKey = 'item.anglertackle.' + id + '_spawn_egg';
    if (out.includes('"' + newKey + '"')) continue;
    // ⚠ 定位用的锚要带结尾引号，**取值用的键不能带** ——
    //   第一版把两者写成同一个字符串，于是查表查的是 `...arapaima"`，
    //   结果 21 个名字全变成 "undefined刷怪蛋"，而且不报错。
    const lookupKey = 'item.anglertackle.' + id;
    const at = out.indexOf(lookupKey + '"');
    if (at < 0) throw new Error('语言文件里找不到 ' + lookupKey);
    const lineStart = out.lastIndexOf('\n', at) + 1;
    const lineEnd = out.indexOf('\n', at);
    const line = out.slice(lineStart, lineEnd);
    const name = JSON.parse('{' + line.replace(/,\s*$/, '') + '}')[lookupKey];
    if (typeof name !== 'string') throw new Error('取不到 ' + lookupKey + ' 的名字：' + line);
    const newLine = '  "' + newKey + '": ' + JSON.stringify(name + suffix) + ',';
    out = out.slice(0, lineEnd + 1) + newLine + '\n' + out.slice(lineEnd + 1);
  }
  return out;
}

// ---------------------------------------------------------------- 写出 / 校验
/** 生成结果：[[绝对路径, 全文], ...]。检查器直接调它比对，不另起进程。 */
function buildOutputs() {
  const MOD_ITEMS = path.join(JAVA, 'registry/ModItems.java');
  const modItems = fs.readFileSync(MOD_ITEMS, 'utf8');
  const withFields = injectModItems(modItems,
    EGG_BEGIN, EGG_END,
    '    // ▼ 鱼刷怪蛋字段插入点（gen-fish-model.js；锚注必须保留）',
    eggFields());
  const withTab = injectModItems(withFields,
    EGG_TAB_BEGIN, EGG_TAB_END,
    '                        // ▼ 鱼刷怪蛋上架插入点（gen-fish-model.js；锚注必须保留）',
    eggTabLines());

  const LANG = path.join(ROOT, 'src/main/resources/assets/anglertackle/lang');
  const outs = [
    [path.join(JAVA, 'client/model/ModFishModel.java'), genModel()],
    [path.join(JAVA, 'fish/FishVariants.java'), genVariants()],
    [path.join(JAVA, 'registry/ModModelLayers.java'), genModelLayers()],
    [MOD_ITEMS, withTab],
  ];
  for (const [file, text] of [
    [path.join(LANG, 'zh_cn.json'), injectLang(fs.readFileSync(path.join(LANG, 'zh_cn.json'), 'utf8'), EGG_SUFFIX.zh)],
    [path.join(LANG, 'en_us.json'), injectLang(fs.readFileSync(path.join(LANG, 'en_us.json'), 'utf8'), EGG_SUFFIX.en)],
  ]) outs.push([file, text]);
  for (const id of IDS()) {
    // 两个文件缺一不可：模型 json 是"画什么"，items/*.json 是"物品种怎么找到它"。
    outs.push([path.join(ROOT, 'src/main/resources/assets/anglertackle/models/item/' + id + '_spawn_egg.json'),
      eggModelJson(id)]);
    outs.push([path.join(ROOT, 'src/main/resources/assets/anglertackle/items/' + id + '_spawn_egg.json'),
      eggItemDefinitionJson(id)]);
  }
  return outs;
}

module.exports = { buildOutputs, norm };

if (require.main === module) {
  let changed = 0;
  for (const [file, text] of buildOutputs()) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    // 只差行尾 ⇒ 不算漂移、也不重写（避免在 CRLF 检出上制造一堆看不见的 diff）。
    if (norm(old) === norm(text)) { console.log('  = ' + path.relative(ROOT, file) + ' 无变化'); continue; }
    if (CHECK) {
      console.log('  ✗ ' + path.relative(ROOT, file) + ' 与生成结果不一致');
      changed++;
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log('  ✎ ' + path.relative(ROOT, file) + (old === null ? '（新建）' : '（更新）'));
    changed++;
  }
  if (CHECK) {
    console.log(changed === 0 ? '✅ 生成的 Java 与数据源一致' : '❌ 有 ' + changed + ' 个文件需要重新生成');
    process.exitCode = changed === 0 ? 0 : 1;
  } else {
    console.log('✅ 生成完毕（' + changed + ' 个文件变更）');
  }
}
