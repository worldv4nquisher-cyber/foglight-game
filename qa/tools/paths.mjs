// QA 脚本共用路径：原来写死在 $QA_DIR、$REPO_ROOT 等处，现在按本文件位置解析，可用环境变量覆盖。
//   QA_DIR     QA 工具目录（快照 snap-*、输出 out/、日志 logs/ 也放这里，均不入库），默认 = 本文件所在目录 qa/tools
//   REPO_ROOT  仓库根（原 $REPO_ROOT，下有 game/ art/ docs/），默认 = QA_DIR/../..
//   PW_TOOLS / PW_BROWSERS  仓库外安装的 Playwright 与浏览器（smoke:xb 用），默认 = 仓库根旁边的 pw-tools / pw-browsers
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_DIR = process.env.QA_DIR ?? dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.REPO_ROOT ?? resolve(QA_DIR, '../..');
export const PW_TOOLS = process.env.PW_TOOLS ?? resolve(REPO_ROOT, '../pw-tools');
export const PW_BROWSERS = process.env.PW_BROWSERS ?? resolve(REPO_ROOT, '../pw-browsers');
