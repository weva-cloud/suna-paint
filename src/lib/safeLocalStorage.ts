// localStorage を「絶対に例外を投げない」形で読み書きするためのアクセサ。
//
// 背景: localStorage は存在チェック(typeof window)を通っても例外を投げることがある。
//   - 端末のストレージが逼迫している(QuotaExceededError)
//   - 組織のポリシーやブラウザ設定でサイトデータが無効化されている
//   - プライベートブラウジングやアプリ内ブラウザの制限
// 保存は「できたら嬉しい」程度の機能なので、失敗しても黙って諦めて本体は動き続けるのが正しい。
// 呼び出し側に try/catch を書かせると必ず書き忘れが出るため、ここに経路を1つへ寄せている。

/**
 * @description localStorage から値を読みます。使えない環境や例外時は null を返します。
 */
export const readLocalStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * @description localStorage へ値を書きます。書けたかどうかを返しますが、失敗しても例外は投げません。
 */
export const writeLocalStorageItem = (key: string, value: string): boolean => {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

/**
 * @description localStorage から値を消します。使えない環境では何もしません。
 */
export const removeLocalStorageItem = (key: string): void => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // 消せなくても実害が無いので握りつぶす
  }
};
