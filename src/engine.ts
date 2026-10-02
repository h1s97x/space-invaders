
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 游戏引擎 —— **参考 czl9707/gh-space-shooter 的 `game_state.py` + `animator.py` 重写**。
 *
 *
 *   1. 策略生成一串离散动作 `(x, shoot)`（参考 `strategies/`）
 *   2. 主循环逐个消费动作：先 `ship.moveTo(action.x)`，
 *      然后 `while (!canTakeAction()) { animate(dt); render() }` 一直走到位，
 *      到位且冷却好了才 `shoot()`（参考 `Animator._generate_frames`）
 *   3. 飞船匀速 12.5 格/秒、`min()` 夹住绝不越过（参考 `Ship.animate`）
 *   4. 子弹 x 是**整数列号**，命中判定 `enemy.x === bullet.x && enemy.y >= bullet.y`
 *      —— 所以永远不会打偏，没有"打空"这个概念
 *   5. 打爆一个格子放**大**爆炸，子弹命中但没打死放**小**爆炸
 *
 * 这套逻辑的"节奏感"来自 `canTakeAction()`：**开火时机由"停稳"决定**，
 * 不是定时器。飞船滑到列下 → 停 → 每 0.2 秒一记 → 直到这一列清空 → 滑向下一列。
 */
import {
  BULLET_SPEED,
  COLS,
  DEFAULT_FPS,
  EXPLOSION_DURATION_LARGE,
  EXPLOSION_DURATION_SMALL,
  EXPLOSION_MAX_RADIUS_LARGE,
  EXPLOSION_MAX_RADIUS_SMALL,
  EXPLOSION_PARTICLE_COUNT_LARGE,
  EXPLOSION_PARTICLE_COUNT_SMALL,
  FORCE_KILL_FRAMES,
  ROWS,
  SHIP_ROW,
  SHIP_SPEED,
  SHIP_SHOOT_COOLDOWN,
  STAR_COUNT,
  STAR_SPEED_MAX,
  STAR_SPEED_MIN,
  TAIL_FRAMES,
  cellX,
  cellY,
  deltaTimeFor,
  frameMsFor,
} from './config.js';
import { Renderer } from './render.js';
import { Rng } from './rng.js';
import {
  Action,
  Bullet,
  Contributions,
  Enemy,
  Explosion,
  Ship,
  Star,
  Strategy,
} from './types.js';
import type { Frame } from './render.js';

/** 一局游戏的状态 —— 对应参考的 `GameState`。 */
export class Engine {
  readonly ship: Ship;
  readonly bullets: Bullet[] = [];
  readonly explosions: Explosion[] = [];
  readonly stars: Star[] = [];
  enemies: Enemy[] = [];

  /** 每帧时间步长（秒）。参考原项目的 `delta_time = 3.0 / fps`。 */
  readonly deltaTime: number;
  readonly frameMs: number;

  frame = 0;
  shots = 0;
  score = 0;
  defeated = 0;
  readonly totalTargets: number;

  private renderer: Renderer;
  private actionGen: Generator<Action>;
  private rows: number[][];

  constructor(
    readonly contrib: Contributions,
    readonly strategy: Strategy = Strategy.COLUMN,
    readonly fps: number = DEFAULT_FPS,
    maxFrames = 0,
    seed?: number,
  ) {
    this.deltaTime = deltaTimeFor(this.fps);
    this.frameMs = frameMsFor(this.fps);
    this.rows = contrib.rows;
    this.rng = new Rng(seed);
    this.renderer = new Renderer(this);

    // 飞船出生在正中间（参考 `Ship.__init__`: x = 25）
    const mid = Math.floor((COLS - 1) / 2);
    this.ship = new Ship(mid);

    this.initEnemies();
    this.initStarfield();
    this.totalTargets = this.enemies.length;
    this.actionGen = this.generateActions(strategy);

    // 帧数上限（参考没有，自己加的兜底）：动作数 × 每动作最大帧数
    this.maxFrames = maxFrames > 0 ? maxFrames : this.enemies.length * 240 + 4000;
  }

  maxFrames: number;

  // ── 敌人初始化：参考 GameState._initialize_enemies ──────────────────────
  private initEnemies(): void {
    // 参考项目直接用 GitHub API 返回的 `level`（0~4）当血量：
    //   `level = day["level"]; if level<=0: continue; Enemy(x,y,health=level)`
    // 而我们 data.ts 拿的是**原始贡献数**（0~40），必须先分档 —— 否则血量会出现
    // hp10、hp40这种值，一列要打 40 发，实测 row 策略直接卡在剩 45 个打不完。
    //
    // 分档方式与 GitHub 官方一致：按**分位数**而不是绝对阈值（早一版用 count//5 的
    // 绝对阈值，真实数据里绝大多数格子都落在 level 1，整张图一片深绿）。
    const positives: number[] = [];
    for (let day = 0; day < ROWS; day++) {
      for (let week = 0; week < COLS; week++) {
        const v = this.rows[day]?.[week] ?? 0;
        if (v > 0) positives.push(v);
      }
    }
    positives.sort((a, b) => a - b);
    const n = positives.length;
    const levelOf = (v: number): number => {
      if (n === 0) return 1;
      // 严格小于 v 的占比（用 lowerBound，重复值扎堆时不会全挤进同一档）
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (positives[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      const frac = lo / n;
      if (frac < 0.25) return 1;
      if (frac < 0.5) return 2;
      if (frac < 0.75) return 3;
      return 4;
    };

    for (let week = 0; week < COLS; week++) {
      for (let day = 0; day < ROWS; day++) {
        // 注意轴向：data.ts 给的是 rows[day][week]（日优先），
        // 参考的 GitHub API 是 weeks[week].days[day]（周优先）。这里按日优先取。
        const count = this.rows[day]?.[week] ?? 0;
        const level = count > 0 ? levelOf(count) : 0;
        if (level <= 0) continue;
        // 血量 = 贡献等级（参考 `Enemy(x=week_idx, y=day_idx, health=level)`）
        this.enemies.push(new Enemy(week, day, level));
      }
    }
  }

  // ── 策略：参考 strategies/ ─────────────────────────────────────────────

  private generateActions(s: Strategy): Generator<Action> {
    if (s === Strategy.ROW) return this.rowStrategy();
    if (s === Strategy.RANDOM) return this.randomStrategy();
    if (s === Strategy.CHAOS) return this.chaosStrategy();
    return this.columnStrategy();
  }

  /**
   * ColumnStrategy（参考）：从第 0 周扫到第 51 周。
   * 对每一周持续 shoot，直到"在飞子弹数 >= 该周总血量"才换下一周。
   */
  private *columnStrategy(): Generator<Action> {
    for (let week = 0; week < COLS; week++) {
      while (true) {
        const inWeek = this.enemies.filter((e) => e.x === week);
        const totalHealth = inWeek.reduce((a, e) => a + e.health, 0);
        const flyingBullets = this.bullets.filter((b) => b.x === week).length;
        if (flyingBullets >= totalHealth) break;
        yield new Action(week, true);
      }
    }
  }

  /**
   * RowStrategy（参考）：从上到下逐行（周六→周日），行内**之字形**排序
   * （`sort(key=lambda e: e.x * (day % 2 * 2 - 1))`），逐格打。
   */
  private *rowStrategy(): Generator<Action> {
    for (let day = ROWS - 1; day >= 0; day--) {
      const inRow = this.enemies.filter((e) => e.y === day);
      // 之字形：奇偶行的列顺序相反，避免每行都从最左边开始（机械）
      inRow.sort((a, b) => a.x * (day % 2 === 0 ? -1 : 1) - b.x * (day % 2 === 0 ? -1 : 1));
      for (const e of inRow) {
        for (let i = 0; i < e.health; i++) yield new Action(e.x, true);
      }
    }
  }

  /**
   * RandomStrategy（参考）：取最近的 8 个有敌人的列，按距离加权随机选一个
   * （同列 10 / 1~3 列 100 / 4 列以上 1），然后对该列**最低**的敌人打 `health` 发。
   */
  private *randomStrategy(): Generator<Action> {
    while (this.enemies.length > 0) {
      const colsWithEnemies = [...new Set(this.enemies.map((e) => e.x))];
      const shipX = this.ship.x;
      const byDistance = colsWithEnemies.sort((a, b) => Math.abs(a - shipX) - Math.abs(b - shipX));
      const candidates = byDistance.slice(0, 8);

      let target: number;
      if (candidates.length === 1) {
        target = candidates[0];
      } else {
        const weights = candidates.map((c) => {
          const d = Math.abs(c - shipX);
          return d === 0 ? 10 : d <= 3 ? 100 : 1;
        });
        target = this.weightedPick(candidates, weights);
      }

      const inCol = this.enemies.filter((e) => e.x === target);
      if (inCol.length === 0) break;
      // 最低的敌人（y 最大 = 视觉上最靠下）
      const lowest = inCol.reduce((a, b) => (b.y > a.y ? b : a));
      for (let i = 0; i < lowest.health; i++) yield new Action(target, true);
    }
  }

  /** ChaosStrategy（我们额外的第四种）：优先打**等级最高**的格子，同级随机。 */
  private *chaosStrategy(): Generator<Action> {
    while (this.enemies.length > 0) {
      const maxHealth = Math.max(...this.enemies.map((e) => e.health));
      const pool = this.enemies.filter((e) => e.health === maxHealth);
      const target = pool[Math.floor(this.rand() * pool.length)];
      for (let i = 0; i < maxHealth; i++) yield new Action(target.x, true);
    }
  }

  private rng: Rng;
  rand(): number {
    return this.rng.next();
  }

  private weightedPick<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, w) => a + w, 0);
    let r = this.rand() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  // ── 主循环：参考 Animator._generate_frames ─────────────────────────────
  //
  //   for action in strategy.generate_actions(game_state):
  //       game_state.ship.move_to(action.x)
  //       while game_state.can_take_action() is False:
  //           game_state.animate(delta_time); yield render()
  //       if action.shoot:
  //           game_state.shoot(); game_state.animate(delta_time); yield render()

  /** 逐帧产出画面（生成器）。 */
  *iterFrames(verbose = true): Generator<Frame> {
    // 参考：yield renderer.render_frame() 作为初始帧
    yield this.renderer.render();

    for (const action of this.actionGen) {
      this.ship.moveTo(action.x);

      // 走到位（且冷却好）才能行动
      let guard = this.maxFrames;
      while (!this.canTakeAction()) {
        this.animate();
        yield this.renderer.render();
        if (--guard <= 0) return;
      }

      if (action.shoot) {
        this.shoot();
        this.animate();
        yield this.renderer.render();
        this.frame++;
        if (verbose && this.frame % 100 === 0) {
          console.log(`  frame ${this.frame}  enemies=${this.enemies.length}`);
        }
      }
    }

    // 收尾（参考 `animator.py:91-99` 的 `force_kill_countdown = 100`）
    let countdown = FORCE_KILL_FRAMES;
    while (!this.isComplete() && countdown-- > 0) {
      this.animate();
      yield this.renderer.render();
    }
    // 补齐收尾：参考那圈只 `animate()` 等在飞子弹落完，**不会补枪**。
    // 而它自己的 `RowStrategy` 是快照式发弹（`for _ in range(enemy.health)` 用的是
    // 当时的血量快照），子弹打空/串格就会少发 —— 实测 row 策略打完只剩最后 1 个活靶，
    // 参考自己的 `while not is_complete()` 意图在这里是达不到的。
    // 下面这段把意图补完整：压着当前最低的活靶继续打，直到真的清完。
    while (!this.isComplete()) {
      const lowest = this.enemies.reduce((a, b) => (b.y > a.y ? b : a));
      this.ship.moveTo(lowest.x);
      let guard = 4000;
      while (!this.canTakeAction() && guard-- > 0) this.animate();
      this.shoot();
      this.animate();
      yield this.renderer.render();
    }
    // 再补几帧让爆炸散完（参考 `for _ in range(5)`）
    for (let i = 0; i < TAIL_FRAMES; i++) {
      this.animate();
      yield this.renderer.render();
    }
  }

  /** 无渲染跑一遍，返回统计（自己加的调参工具，参考没有）。 */
  simulate(): { cleared: boolean; frames: number; shots: number; enemies: number } {
    let frames = 0;
    for (const action of this.actionGen) {
      this.ship.moveTo(action.x);
      let guard = this.maxFrames;
      while (!this.canTakeAction()) {
        this.animate();
        frames++;
        if (--guard <= 0) return { cleared: this.enemies.length === 0, frames, shots: this.shots, enemies: this.enemies.length };
      }
      if (action.shoot) {
        this.shoot();
        this.animate();
        frames++;
      }
    }
    let countdown = FORCE_KILL_FRAMES;
    while (!this.isComplete() && countdown-- > 0) {
      this.animate();
      frames++;
    }
    // 与 iterFrames 同一段收尾补枪（参考的 force_kill 只等不打）
    while (!this.isComplete()) {
      const lowest = this.enemies.reduce((a, b) => (b.y > a.y ? b : a));
      this.ship.moveTo(lowest.x);
      let guard = 4000;
      while (!this.canTakeAction() && guard-- > 0) {
        this.animate();
        frames++;
      }
      this.shoot();
      this.animate();
      frames++;
    }
    return { cleared: this.enemies.length === 0, frames, shots: this.shots, enemies: this.enemies.length };
  }

  // ── GameState 的方法 ────────────────────────────────────────────────────

  /** 清完没有（参考 `is_complete`）。 */
  isComplete(): boolean {
    return this.enemies.length === 0;
  }

  /** 能否行动 = 不在移动中 且 冷却好了（参考 `can_take_action`）。 */
  canTakeAction(): boolean {
    return !this.ship.isMoving() && this.ship.canShoot();
  }

  /** 开一炮（参考 `GameState.shoot`）：子弹 x = 飞船当前列（整数），y 从船头顶开始。 */
  shoot(): void {
    this.bullets.push(new Bullet(Math.round(this.ship.x), SHIP_ROW - 1));
    this.ship.shootCooldown = SHIP_SHOOT_COOLDOWN;
    this.shots++;
  }

  /** 推进一帧（参考 `GameState.animate`）：星空 → 飞船 → 敌人 → 子弹 → 爆炸。 */
  animate(): void {
    this.animateStars();
    this.ship.animate(this.deltaTime, SHIP_SPEED);
    this.animateBullets();
    this.animateExplosions();
  }

  private animateStars(): void {
    for (const s of this.stars) {
      s.y += s.speed * this.deltaTime;
      if (s.y > SHIP_ROW + 4) {
        s.y = -2;
        s.x = this.rand() * (COLS + 4) - 2;
      }
    }
  }

  /** 子弹上移 + 碰撞（参考 `Bullet.animate` + `_check_collision`）。 */
  private animateBullets(): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.y -= BULLET_SPEED * this.deltaTime;

      // 命中判定：同一列 且 敌人在子弹下方（y >= bullet.y，y 向下增大）
      const victim = this.enemies.find((e) => e.x === b.x && e.y >= b.y);
      if (victim) {
        // 先记下**打爆前的血量**（= 贡献等级），再结算伤害。
        // 反过来写的话 takeDamage() 已经把 health 减到 0，score 会永远是 0。
        const level = victim.health;
        const result = victim.takeDamage();
        this.addExplosion(b.x, b.y, result === 'dead' ? 'large' : 'small');
        if (result === 'dead') {
          this.score += level * 20;
          this.defeated++;
          this.enemies.splice(this.enemies.indexOf(victim), 1);
        }
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.y < -10) this.bullets.splice(i, 1); // 出屏
    }
  }

  private animateExplosions(): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.elapsed += this.deltaTime;
      if (e.elapsed >= e.duration) this.explosions.splice(i, 1);
    }
  }

  private addExplosion(x: number, y: number, size: 'small' | 'large'): void {
    const large = size === 'large';
    const n = large ? EXPLOSION_PARTICLE_COUNT_LARGE : EXPLOSION_PARTICLE_COUNT_SMALL;
    const angles: number[] = [];
    for (let i = 0; i < n; i++) angles.push(this.rand() * Math.PI * 2);
    this.explosions.push(
      new Explosion(
        x,
        y,
        size,
        large ? EXPLOSION_DURATION_LARGE : EXPLOSION_DURATION_SMALL,
        large ? EXPLOSION_MAX_RADIUS_LARGE : EXPLOSION_MAX_RADIUS_SMALL,
        n,
        angles,
      ),
    );
  }

  /** 星空初始化（参考 `Starfield.__init__`：100 颗，1~4 格随机位置，亮度决定速度）。 */
  private initStarfield(): void {
    for (let i = 0; i < STAR_COUNT; i++) {
      const brightness = this.rand() * 0.8 + 0.2;
      this.stars.push(
        new Star(
          this.rand() * (COLS + 4) - 2,
          this.rand() * (SHIP_ROW + 6) - 2,
          brightness,
          // 参考用 random.choice([1,1,1,2])：1px 居多
          this.rand() < 0.75 ? 1 : 2,
          // 越亮越快 = 越近（参考 speed = MIN + brightness * (MAX - MIN)）
          STAR_SPEED_MIN + brightness * (STAR_SPEED_MAX - STAR_SPEED_MIN),
        ),
      );
    }
  }

  /** 像素坐标转换（渲染层用）。 */
  px(x: number): number {
    return cellX(x);
  }
  py(y: number): number {
    return cellY(y);
  }

  /** 统计信息（自己加的，参考没有）。 */
  get stats() {
    return {
      frame: this.frame,
      shots: this.shots,
      score: this.score,
      defeated: this.defeated,
      total: this.totalTargets,
      enemiesLeft: this.enemies.length,
    };
  }
}

