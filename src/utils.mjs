/*
 * Block the calling thread for the specified number of milliseconds.
 * Reference: https://stackoverflow.com/a/39914235.
 */
export async function sleep(millis) {
    await new Promise(resolve => setTimeout(resolve, millis));
}
